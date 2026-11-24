import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { AxaError } from "./errors.js";
import { writeFileAtomic } from "./fs-utils.js";
import { configLockPath, withLock } from "./lock.js";
import {
  expandHomePath,
  findProjectRoot,
  isAxaProject,
  pathExists,
  readProjectInfo,
  SKILL_FILE,
  TASKS_README_FILE,
} from "./paths.js";
import { isPortableProjectId, resolveProjectIdentity } from "./project-id.js";
import { initProject } from "./tasks.js";
import type { AxaConfig, ListProjectsResult, ProjectConfig } from "./types.js";

const CONFIG_VERSION = 1;

/** Every "@contagxt" package keeps its data under one hidden home directory. */
const CONTAGXT_DIR = ".contagxt";
const AXA_DIR_NAME = "axa";

export function getAxaHome(): string {
  return process.env.AXA_HOME
    ? resolve(expandHomePath(process.env.AXA_HOME))
    : join(homedir(), CONTAGXT_DIR, AXA_DIR_NAME);
}

export function getConfigPath(): string {
  return join(getAxaHome(), "config.json");
}

function emptyConfig(): AxaConfig {
  return { version: CONFIG_VERSION, projects: [] };
}

function validateConfig(value: unknown): AxaConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AxaError("CONFIG_ERROR", "axa config must be a JSON object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== CONFIG_VERSION) {
    throw new AxaError("CONFIG_ERROR", `Unsupported axa config version: ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.projects)) {
    throw new AxaError("CONFIG_ERROR", "axa config projects must be an array.");
  }

  const projects: ProjectConfig[] = raw.projects.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AxaError("CONFIG_ERROR", `Invalid project entry at index ${index}.`);
    }
    const project = entry as Record<string, unknown>;
    const fields = ["id", "name", "path", "addedAt"] as const;
    for (const field of fields) {
      if (typeof project[field] !== "string" || !project[field]) {
        throw new AxaError("CONFIG_ERROR", `Project entry ${index} is missing "${field}".`);
      }
    }
    return {
      id: project.id as string,
      name: project.name as string,
      path: project.path as string,
      addedAt: project.addedAt as string,
    };
  });

  return {
    version: CONFIG_VERSION,
    projects,
    ...(typeof raw.defaultProjectId === "string" ? { defaultProjectId: raw.defaultProjectId } : {}),
  };
}

/**
 * #026 replaced name-based ids with portable project ids, but entries written
 * by older versions keep their old id until the project is visited. Upgrade
 * those entries as soon as the registry is loaded so every consumer (CLI,
 * console, secretary) sees a consistent id. Missing projects are left intact
 * rather than dropped, so no stored data is lost.
 */
async function upgradeLegacyProjectIds(config: AxaConfig): Promise<boolean> {
  let changed = false;
  for (const project of config.projects) {
    if (isPortableProjectId(project.id)) continue;

    let upgraded: string;
    if (project.id.startsWith("git:")) {
      // The old prefix carries no extra information: strip it in place so the
      // migration works even when the project directory is gone.
      upgraded = project.id.slice("git:".length);
    } else {
      if (!(await isAxaProject(project.path))) continue;
      try {
        const identity = await resolveProjectIdentity(project.path);
        upgraded = identity.id;
      } catch {
        // Keep the original entry if its project cannot be resolved.
        continue;
      }
    }

    if (upgraded === project.id) continue;
    if (config.projects.some((other) => other !== project && other.id === upgraded)) continue;
    const previousId = project.id;
    project.id = upgraded;
    if (config.defaultProjectId === previousId) {
      config.defaultProjectId = upgraded;
    }
    changed = true;
  }
  return changed;
}

export async function readConfig(): Promise<AxaConfig> {
  let content: string;
  try {
    content = await readFile(getConfigPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyConfig();
    }
    throw error;
  }

  try {
    const config = validateConfig(JSON.parse(content));
    if (await upgradeLegacyProjectIds(config)) {
      await writeConfig(config);
    }
    return config;
  } catch (error) {
    if (error instanceof AxaError) throw error;
    throw new AxaError("CONFIG_ERROR", `Cannot parse ${getConfigPath()}.`, { cause: error });
  }
}

async function writeConfig(config: AxaConfig): Promise<void> {
  await writeFileAtomic(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

async function mutateConfig<T>(mutator: (config: AxaConfig) => Promise<T> | T): Promise<T> {
  return withLock(configLockPath(getAxaHome()), async () => {
    const config = await readConfig();
    const result = await mutator(config);
    await writeConfig(config);
    return result;
  });
}

async function canonicalProjectPath(input: string): Promise<string> {
  const absolute = resolve(expandHomePath(input));
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

export interface RegisterProjectInput {
  path: string;
  name?: string;
  initialize?: boolean;
}

export async function registerProject(input: RegisterProjectInput): Promise<ProjectConfig> {
  let projectPath = await canonicalProjectPath(input.path);
  if (input.initialize && !(await isAxaProject(projectPath))) {
    await initProject({ projectRoot: projectPath, ...(input.name ? { name: input.name } : {}) });
  }
  if (!(await pathExists(projectPath))) {
    throw new AxaError("INVALID_PROJECT", `Project path does not exist: ${projectPath}`);
  }
  if (!(await isAxaProject(projectPath))) {
    throw new AxaError(
      "INVALID_PROJECT",
      `${projectPath} is not an axa project. Enable initialization or run "axa init".`,
    );
  }
  projectPath = await canonicalProjectPath(projectPath);
  const name = input.name?.trim() || basename(projectPath);
  const identity = await resolveProjectIdentity(projectPath);

  return mutateConfig((config) => {
    const existing = findProjectEntry(config, identity.id, identity.previousId, projectPath);
    if (existing) {
      applyProjectIdentity(config, existing, identity.id, projectPath);
      existing.name = name;
      return existing;
    }

    const project: ProjectConfig = {
      id: identity.id,
      name,
      path: projectPath,
      addedAt: new Date().toISOString(),
    };
    config.projects.push(project);
    config.defaultProjectId ??= project.id;
    return project;
  });
}

function findProjectEntry(
  config: AxaConfig,
  projectId: string,
  previousId: string | undefined,
  projectPath: string,
): ProjectConfig | undefined {
  return (
    config.projects.find((project) => project.id === projectId) ??
    (previousId ? config.projects.find((project) => project.id === previousId) : undefined) ??
    config.projects.find((project) => resolve(project.path) === projectPath)
  );
}

/** Move a registry entry to the current id/path and keep the default pointer valid. */
function applyProjectIdentity(
  config: AxaConfig,
  project: ProjectConfig,
  projectId: string,
  projectPath: string,
): void {
  const previousId = project.id;
  project.id = projectId;
  project.path = projectPath;
  if (config.defaultProjectId === previousId) {
    config.defaultProjectId = projectId;
  }
  // A portable id identifies exactly one project, so drop stale duplicates.
  config.projects = config.projects.filter(
    (candidate) => candidate === project || candidate.id !== projectId,
  );
}

/**
 * Re-map a registered project to its current physical path and identity.
 *
 * Called when a command runs inside a project, so moving a project directory or
 * adding a git remote upgrades the global registry without user intervention.
 * Unknown (unregistered) projects are left untouched.
 */
export async function syncRegisteredProjectPath(
  projectRoot: string,
): Promise<ProjectConfig | undefined> {
  if (!(await isAxaProject(projectRoot))) return undefined;
  const projectPath = await canonicalProjectPath(projectRoot);
  const identity = await resolveProjectIdentity(projectPath);

  const config = await readConfig();
  const current = findProjectEntry(config, identity.id, identity.previousId, projectPath);
  if (!current) return undefined;
  if (current.id === identity.id && current.path === projectPath) {
    return current;
  }

  return mutateConfig((draft) => {
    const project = findProjectEntry(draft, identity.id, identity.previousId, projectPath);
    if (!project) return undefined;
    applyProjectIdentity(draft, project, identity.id, projectPath);
    return project;
  });
}

export async function listRegisteredProjects(): Promise<ListProjectsResult[]> {
  const config = await readConfig();
  return Promise.all(
    config.projects.map(async (project) => {
      const exists = await isAxaProject(project.path);
      if (!exists) {
        return {
          id: project.id,
          name: project.name,
          path: project.path,
          axaPath: join(project.path, ".axa"),
          skillPath: join(project.path, ".axa", SKILL_FILE),
          tasksReadmePath: join(project.path, ".axa", "tasks", TASKS_README_FILE),
          counts: { backlog: 0, todo: 0, doing: 0, review: 0, done: 0, archived: 0 },
          total: 0,
          exists: false,
        };
      }
      const info = await readProjectInfo(project.path);
      return {
        ...info,
        id: project.id,
        name: project.name,
        exists: true,
      };
    }),
  );
}

export async function getRegisteredProject(idOrPath: string): Promise<ProjectConfig> {
  const config = await readConfig();
  const absolute = resolve(expandHomePath(idOrPath));
  const project = config.projects.find(
    (candidate) =>
      candidate.id === idOrPath ||
      resolve(candidate.path) === absolute ||
      candidate.name.toLowerCase() === idOrPath.toLowerCase(),
  );
  if (!project) {
    throw new AxaError("NOT_FOUND", `Project is not registered: ${idOrPath}`);
  }
  return project;
}

export async function removeRegisteredProject(id: string): Promise<ProjectConfig> {
  return mutateConfig((config) => {
    const index = config.projects.findIndex(
      (project) => project.id === id || resolve(project.path) === resolve(id),
    );
    if (index < 0) {
      throw new AxaError("NOT_FOUND", `Project is not registered: ${id}`);
    }
    const [removed] = config.projects.splice(index, 1);
    if (!removed) {
      throw new AxaError("NOT_FOUND", `Project is not registered: ${id}`);
    }
    if (config.defaultProjectId === removed.id) {
      const next = config.projects[0];
      if (next) {
        config.defaultProjectId = next.id;
      } else {
        delete config.defaultProjectId;
      }
    }
    return removed;
  });
}

export async function setDefaultProject(id: string): Promise<ProjectConfig> {
  return mutateConfig((config) => {
    const project = config.projects.find((candidate) => candidate.id === id);
    if (!project) {
      throw new AxaError("NOT_FOUND", `Project is not registered: ${id}`);
    }
    config.defaultProjectId = project.id;
    return project;
  });
}

export async function resolveCliProject(input?: string): Promise<string> {
  if (input) {
    const direct = resolve(expandHomePath(input));
    if (await isAxaProject(direct)) {
      await syncRegisteredProjectPath(direct);
      return direct;
    }
    if (basename(direct) === ".axa" && (await pathExists(direct))) {
      const root = resolve(direct, "..");
      await syncRegisteredProjectPath(root);
      return root;
    }
    try {
      const project = await getRegisteredProject(input);
      if (await isAxaProject(project.path)) {
        const synced = await syncRegisteredProjectPath(project.path);
        return synced?.path ?? project.path;
      }
      throw new AxaError(
        "INVALID_PROJECT",
        `Registered project is missing or no longer an axa project: ${project.path}`,
      );
    } catch (error) {
      if (error instanceof AxaError && error.code === "NOT_FOUND") {
        throw new AxaError(
          "INVALID_PROJECT",
          `Unknown project "${input}". Pass a valid path or register it with "axa projects add".`,
        );
      }
      throw error;
    }
  }

  const local = await findProjectRoot(process.cwd());
  if (local) {
    await syncRegisteredProjectPath(local);
    return local;
  }

  const config = await readConfig();
  const defaultId = config.defaultProjectId;
  if (defaultId) {
    const project = config.projects.find((candidate) => candidate.id === defaultId);
    if (project && (await isAxaProject(project.path))) {
      const synced = await syncRegisteredProjectPath(project.path);
      return synced?.path ?? project.path;
    }
  }

  throw new AxaError(
    "INVALID_PROJECT",
    'No project selected. Run "axa init" here or pass --project <path|id>.',
  );
}
