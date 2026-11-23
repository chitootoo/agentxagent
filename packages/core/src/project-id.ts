import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { AxaError } from "./errors.js";
import { writeFileAtomic } from "./fs-utils.js";
import { projectAxaDir } from "./paths.js";

const execFileAsync = promisify(execFile);

export const PROJECT_CONFIG_FILE = "config.json";
const PROJECT_CONFIG_VERSION = 1;
const GIT_TIMEOUT_MS = 5_000;

const PORTABLE_GIT_PROTOCOLS = new Set([
  "git",
  "ssh",
  "git+ssh",
  "http",
  "https",
  "git+http",
  "git+https",
]);

export interface ProjectLocalConfig {
  version: 1;
  /** Stable portable id persisted in `.axa/config.json`. */
  projectId: string;
}

export interface ProjectIdentity {
  /** `<host>/<owner>/<repo>` when an origin exists, otherwise `local:<uuid>`. */
  id: string;
  /** True when the id is derived from `git remote get-url origin`. */
  remote: boolean;
  /** Previous id that was replaced when a local id was upgraded to a git remote id. */
  previousId?: string;
}

export function projectConfigPath(projectRoot: string): string {
  return join(projectAxaDir(projectRoot), PROJECT_CONFIG_FILE);
}

/**
 * Normalize SSH / HTTPS git remote URLs so the same repository resolves to the
 * same project id on every machine.
 *
 * Examples:
 * - `git@github.com:owner/repo.git` -> `github.com/owner/repo`
 * - `ssh://git@github.com/owner/repo.git` -> `github.com/owner/repo`
 * - `https://github.com/owner/repo.git` -> `github.com/owner/repo`
 */
export function normalizeGitRemoteUrl(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;

  let host: string;
  let path: string;

  if (value.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return undefined;
    }
    const protocol = parsed.protocol.replace(/:$/u, "");
    if (!PORTABLE_GIT_PROTOCOLS.has(protocol) || !parsed.hostname) {
      return undefined;
    }
    host = parsed.hostname.toLowerCase();
    if (parsed.port) host = `${host}:${parsed.port}`;
    path = parsed.pathname;
  } else {
    // scp-like syntax: [user@]host:path
    const scp = /^(?:[^@/:\s]+@)?([^:/@\s]+):(.+)$/u.exec(value);
    if (!scp?.[1] || !scp[2]) return undefined;
    host = scp[1].toLowerCase();
    path = scp[2];
  }

  path = path
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
  if (!path) return undefined;

  return `${host}/${path}`;
}

/**
 * A portable id is either `local:<uuid>` or a normalized git remote
 * `<host>/<owner>/<repo>`. The old `git:` prefix (from #026) and plain
 * name-based ids are not portable and need migration.
 */
export function isPortableProjectId(id: string): boolean {
  if (id.startsWith("local:")) return true;
  if (id.startsWith("git:")) return false;
  return /^[^/\s]+\.[^/\s]+\/.+$/u.test(id);
}

export async function readGitRemoteUrl(projectRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectRoot, "remote", "get-url", "origin"],
      { timeout: GIT_TIMEOUT_MS },
    );
    const value = stdout.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
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
  if (typeof raw.projectId !== "string" || !raw.projectId.trim()) {
    throw new AxaError("CONFIG_ERROR", `${filePath} is missing "projectId".`);
  }
  return { version: PROJECT_CONFIG_VERSION, projectId: raw.projectId.trim() };
}

export async function readProjectLocalConfig(
  projectRoot: string,
): Promise<ProjectLocalConfig | undefined> {
  const filePath = projectConfigPath(projectRoot);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseLocalConfig(content, filePath);
}

export async function writeProjectLocalConfig(
  projectRoot: string,
  config: ProjectLocalConfig,
): Promise<void> {
  await writeFileAtomic(projectConfigPath(projectRoot), `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Resolve the portable project id.
 *
 * The git origin wins. When a local id is persisted in `.axa/config.json` and a
 * remote appears later, the id is upgraded and the old id is returned as
 * `previousId` so the global registry can migrate its mapping.
 */
export async function resolveProjectIdentity(projectRoot: string): Promise<ProjectIdentity> {
  const local = await readProjectLocalConfig(projectRoot);
  const remoteUrl = await readGitRemoteUrl(projectRoot);
  const remoteId = remoteUrl ? normalizeGitRemoteUrl(remoteUrl) : undefined;

  if (remoteId) {
    if (local?.projectId !== remoteId) {
      await writeProjectLocalConfig(projectRoot, {
        version: PROJECT_CONFIG_VERSION,
        projectId: remoteId,
      });
      return {
        id: remoteId,
        remote: true,
        ...(local?.projectId ? { previousId: local.projectId } : {}),
      };
    }
    return { id: remoteId, remote: true };
  }

  if (local) {
    if (local.projectId.startsWith("git:")) {
      const upgraded = local.projectId.slice("git:".length);
      await writeProjectLocalConfig(projectRoot, {
        version: PROJECT_CONFIG_VERSION,
        projectId: upgraded,
      });
      return { id: upgraded, remote: false, previousId: local.projectId };
    }
    return { id: local.projectId, remote: false };
  }

  const id = `local:${randomUUID()}`;
  await writeProjectLocalConfig(projectRoot, { version: PROJECT_CONFIG_VERSION, projectId: id });
  return { id, remote: false };
}
