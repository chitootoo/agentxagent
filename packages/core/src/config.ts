import { readFile, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { AxaError } from "./errors.js";
import { writeFileAtomic } from "./fs-utils.js";
import { getAxaHome, getConfigPath } from "./home.js";
import { configLockPath, withLock } from "./lock.js";
import {
  expandHomePath,
  findProjectRoot,
  isAxaProject,
  pathExists,
  projectAxaDir,
  readProjectInfo,
  SKILL_FILE,
  TASKS_README_FILE,
} from "./paths.js";
import { isProjectId, newProjectId } from "./project-ids.js";
import {
  ensureManagedProject,
  listProjectRefs,
  projectIdFromLink,
  readProjectRef,
  removeProjectRef,
} from "./project-store.js";
import { initProject } from "./tasks.js";
import type { AxaConfig, ListProjectsResult, ProjectConfig } from "./types.js";

const CONFIG_VERSION = 1;

function emptyConfig(): AxaConfig {
  return { version: CONFIG_VERSION };
}

function validateConfig(value: unknown): AxaConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AxaError("CONFIG_ERROR", "axa config must be a JSON object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== CONFIG_VERSION) {
    throw new AxaError("CONFIG_ERROR", `Unsupported axa config version: ${String(raw.version)}`);
  }
  return {
    version: CONFIG_VERSION,
    ...(typeof raw.defaultProjectId === "string" ? { defaultProjectId: raw.defaultProjectId } : {}),
  };
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
    return validateConfig(JSON.parse(content));
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

function samePath(left: string, right: string): boolean {
  return resolve(expandHomePath(left)) === resolve(expandHomePath(right));
}

export interface RegisterProjectInput {
  path: string;
  initialize?: boolean;
}

/**
 * Register a project under `$AXA_HOME/projects/<id>/`.
 *
 * The project id is recovered from an existing `<project>/.axa` symlink, or a
 * fresh UUID is generated. The real `.axa/` directory lives in the management
 * folder; `<project>/.axa` becomes a symlink to it so workers keep using the
 * familiar path.
 */
export async function registerProject(input: RegisterProjectInput): Promise<ProjectConfig> {
  const projectPath = await canonicalProjectPath(input.path);
  if (!input.initialize && !(await pathExists(projectPath))) {
    throw new AxaError("INVALID_PROJECT", `Project path does not exist: ${projectPath}`);
  }
  if (!input.initialize && !(await isAxaProject(projectPath))) {
    throw new AxaError(
      "INVALID_PROJECT",
      `${projectPath} is not an axa project. Enable initialization or run "axa-project init".`,
    );
  }

  const linkedId = await projectIdFromLink(projectPath);
  const projects = await listProjectRefs();
  const existing =
    projects.find((project) => samePath(project.path, projectPath)) ??
    (linkedId ? await readProjectRef(linkedId) : undefined);

  const id = existing?.id ?? linkedId ?? newProjectId();
  const project: ProjectConfig = {
    id,
    name: basename(projectPath),
    path: projectPath,
    addedAt: existing?.addedAt || new Date().toISOString(),
  };

  await ensureManagedProject(project);
  if (input.initialize) {
    await initProject({ projectRoot: projectPath });
  }
  await mutateConfig((config) => {
    config.defaultProjectId ??= id;
  });
  return project;
}

/**
 * Re-map a registered project to its current physical path.
 *
 * Called when a command runs inside a project, so moving a project directory
 * updates the `project.ref` and keeps the `.axa` symlink pointing at the
 * management folder. Unknown (unregistered) projects are left untouched.
 */
export async function syncRegisteredProjectPath(
  projectRoot: string,
): Promise<ProjectConfig | undefined> {
  if (!(await isAxaProject(projectRoot))) return undefined;
  const projectPath = await canonicalProjectPath(projectRoot);
  const linkedId = await projectIdFromLink(projectPath);
  const projects = await listProjectRefs();
  const entry =
    (linkedId ? projects.find((project) => project.id === linkedId) : undefined) ??
    projects.find((project) => samePath(project.path, projectPath));
  if (!entry) return undefined;

  const synced: ProjectConfig = { ...entry, path: projectPath };
  await ensureManagedProject(synced);
  return synced;
}

function emptyProjectsResult(project: ProjectConfig): ListProjectsResult {
  const axaPath = projectAxaDir(project.path);
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    axaPath,
    skillPath: join(axaPath, SKILL_FILE),
    tasksReadmePath: join(axaPath, "tasks", TASKS_README_FILE),
    counts: { backlog: 0, todo: 0, doing: 0, review: 0, done: 0, archived: 0 },
    total: 0,
    exists: false,
  };
}

export async function listRegisteredProjects(): Promise<ListProjectsResult[]> {
  const projects = await listProjectRefs();
  return Promise.all(
    projects.map(async (project) => {
      if (!(await isAxaProject(project.path))) return emptyProjectsResult(project);
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
  const projects = await listProjectRefs();
  const project =
    projects.find((candidate) => candidate.id === idOrPath) ??
    projects.find((candidate) => samePath(candidate.path, idOrPath)) ??
    projects.find((candidate) => candidate.name.toLowerCase() === idOrPath.toLowerCase());
  if (!project) {
    throw new AxaError("NOT_FOUND", `Project is not registered: ${idOrPath}`);
  }
  return project;
}

/** Unregister a project by removing its `project.ref`; task data is kept. */
export async function removeRegisteredProject(id: string): Promise<ProjectConfig> {
  const projects = await listProjectRefs();
  const removed =
    projects.find((project) => project.id === id) ??
    projects.find((project) => samePath(project.path, id));
  if (!removed) {
    throw new AxaError("NOT_FOUND", `Project is not registered: ${id}`);
  }

  await removeProjectRef(removed.id);
  await mutateConfig((config) => {
    if (config.defaultProjectId !== removed.id) return;
    const next = projects.find((project) => project.id !== removed.id);
    if (next) {
      config.defaultProjectId = next.id;
    } else {
      delete config.defaultProjectId;
    }
  });
  return removed;
}

export async function setDefaultProject(id: string): Promise<ProjectConfig> {
  const project = (await listProjectRefs()).find((candidate) => candidate.id === id);
  if (!project) {
    throw new AxaError("NOT_FOUND", `Project is not registered: ${id}`);
  }
  await mutateConfig((config) => {
    config.defaultProjectId = project.id;
  });
  return project;
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
          `Unknown project "${input}". Pass a valid path or register it with "axa-project add".`,
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
  if (config.defaultProjectId && isProjectId(config.defaultProjectId)) {
    const project = await readProjectRef(config.defaultProjectId);
    if (project && (await isAxaProject(project.path))) {
      const synced = await syncRegisteredProjectPath(project.path);
      return synced?.path ?? project.path;
    }
  }

  throw new AxaError(
    "INVALID_PROJECT",
    'No project selected. Run "axa-project init" here or pass --project <path|id>.',
  );
}
