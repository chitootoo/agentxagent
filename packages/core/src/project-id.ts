import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AxaError } from "./errors.js";
import { writeFileAtomic } from "./fs-utils.js";
import { projectAxaDir } from "./paths.js";
import { newProjectId } from "./project-ids.js";

export const PROJECT_CONFIG_FILE = "config.json";
const PROJECT_CONFIG_VERSION = 1;

export interface ProjectLocalConfig {
  version: 1;
  /** Unique id assigned when the project is registered. */
  projectId: string;
  /** Optional human-readable name shown in the CLI and console. */
  name?: string;
}

export interface ProjectIdentity {
  /** Unique project id. Management folder: `$AXA_HOME/projects/<id>`. */
  id: string;
}

export function projectConfigPath(projectRoot: string): string {
  return join(projectAxaDir(projectRoot), PROJECT_CONFIG_FILE);
}

function parseLocalConfig(content: string, filePath: string): ProjectLocalConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new AxaError("CONFIG_ERROR", `Cannot parse ${filePath}.`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AxaError("CONFIG_ERROR", `${filePath} must be a JSON object.`);
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.version !== PROJECT_CONFIG_VERSION) {
    throw new AxaError(
      "CONFIG_ERROR",
      `Unsupported project config version in ${filePath}: ${String(raw.version)}`,
    );
  }
  if (typeof raw.projectId !== "string" || raw.projectId === "") {
    throw new AxaError("CONFIG_ERROR", `${filePath} is missing a valid "projectId".`);
  }
  return {
    version: PROJECT_CONFIG_VERSION,
    projectId: raw.projectId,
    ...(typeof raw.name === "string" && raw.name !== "" ? { name: raw.name } : {}),
  };
}

export async function readProjectConfigAt(axaDir: string): Promise<ProjectLocalConfig | undefined> {
  const filePath = join(axaDir, PROJECT_CONFIG_FILE);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseLocalConfig(content, filePath);
}

export async function writeProjectConfigAt(
  axaDir: string,
  config: ProjectLocalConfig,
): Promise<void> {
  await writeFileAtomic(join(axaDir, PROJECT_CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
}

export async function readProjectLocalConfig(
  projectRoot: string,
): Promise<ProjectLocalConfig | undefined> {
  return readProjectConfigAt(projectAxaDir(projectRoot));
}

export async function writeProjectLocalConfig(
  projectRoot: string,
  config: ProjectLocalConfig,
): Promise<void> {
  await writeProjectConfigAt(projectAxaDir(projectRoot), config);
}

/** Use the persisted project id, or assign a fresh unique one. */
export async function resolveProjectIdentity(projectRoot: string): Promise<ProjectIdentity> {
  const local = await readProjectLocalConfig(projectRoot);
  if (local) return { id: local.projectId };

  const id = newProjectId();
  await writeProjectLocalConfig(projectRoot, { version: PROJECT_CONFIG_VERSION, projectId: id });
  return { id };
}
