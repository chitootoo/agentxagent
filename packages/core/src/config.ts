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
} from "./paths.js";
import { initProject } from "./tasks.js";
import type { AxaConfig, ListProjectsResult, ProjectConfig } from "./types.js";

const CONFIG_VERSION = 1;

export function getAxaHome(): string {
  return process.env.AXA_HOME ? resolve(process.env.AXA_HOME) : join(homedir(), ".axa");
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

function projectIdBase(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "project";
}

function uniqueId(base: string, projects: ProjectConfig[]): string {
  const existing = new Set(projects.map((project) => project.id));
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
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

  return mutateConfig((config) => {
    const existing = config.projects.find((project) => resolve(project.path) === projectPath);
    if (existing) {
      existing.name = name;
      return existing;
    }

    const project: ProjectConfig = {
      id: uniqueId(projectIdBase(name), config.projects),
      name,
      path: projectPath,
      addedAt: new Date().toISOString(),
    };
    config.projects.push(project);
    config.defaultProjectId ??= project.id;
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
          instructionPath: join(project.path, ".axa", "instruction.md"),
          counts: { backlog: 0, todo: 0, doing: 0, done: 0 },
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
      return direct;
    }
    if (basename(direct) === ".axa" && (await pathExists(direct))) {
      return resolve(direct, "..");
    }
    try {
      const project = await getRegisteredProject(input);
      if (await isAxaProject(project.path)) {
        return project.path;
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
  if (local) return local;

  const config = await readConfig();
  const defaultId = config.defaultProjectId;
  if (defaultId) {
    const project = config.projects.find((candidate) => candidate.id === defaultId);
    if (project && (await isAxaProject(project.path))) {
      return project.path;
    }
  }

  throw new AxaError(
    "INVALID_PROJECT",
    'No project selected. Run "axa init" here or pass --project <path|id>.',
  );
}
