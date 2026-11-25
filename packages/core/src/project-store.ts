import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readlink, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  addRef,
  applyRef,
  expandPath,
  ReferError,
  type RefManifest,
  type Reporter,
  readRef,
  replayRef,
  resolveLocalReference,
  type Session,
} from "@contagxt/refer";
import { AxaError } from "./errors.js";
import { getProjectsRoot } from "./home.js";
import { AXA_DIR, isAxaProject, pathExists, projectAxaDir } from "./paths.js";
import { isProjectId } from "./project-ids.js";
import type { ProjectConfig } from "./types.js";

/** A project owns one management folder under `$AXA_HOME/projects/<id>`. */
export const PROJECT_REF_FILE = "project.ref";

const SILENT_REPORTER: Reporter = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  hint: () => undefined,
  debug: () => undefined,
};

function referSession(): Session {
  return { env: process.env, reporter: SILENT_REPORTER, force: false };
}

function toAxaError(error: unknown, fallback: string): AxaError {
  if (error instanceof AxaError) return error;
  const message = error instanceof ReferError ? error.message : fallback;
  return new AxaError("CONFIG_ERROR", message, { cause: error });
}

export function projectManageDir(projectId: string): string {
  if (!isProjectId(projectId)) {
    throw new AxaError("CONFIG_ERROR", `Invalid project id: ${projectId}`);
  }
  return join(getProjectsRoot(), projectId);
}

export function managedAxaDir(projectId: string): string {
  return join(projectManageDir(projectId), AXA_DIR);
}

export function projectRefPath(projectId: string): string {
  return join(projectManageDir(projectId), PROJECT_REF_FILE);
}

interface LinkState {
  kind: "missing" | "symlink" | "directory" | "file";
  target?: string;
}

async function describeLink(path: string): Promise<LinkState> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      return { kind: "symlink", target: resolve(dirname(path), await readlink(path)) };
    }
    return { kind: stats.isDirectory() ? "directory" : "file" };
  } catch {
    return { kind: "missing" };
  }
}

function isUnderProjectsRoot(path: string): boolean {
  return path.startsWith(`${getProjectsRoot()}${sep}`);
}

/** Recover a project id from the `<project>/.axa` symlink into the management folder. */
export async function projectIdFromLink(projectRoot: string): Promise<string | undefined> {
  const state = await describeLink(projectAxaDir(projectRoot));
  if (state.kind !== "symlink" || !state.target || basename(state.target) !== AXA_DIR) {
    return undefined;
  }
  const manageDir = dirname(state.target);
  if (!isUnderProjectsRoot(manageDir)) return undefined;
  const id = basename(manageDir);
  return isProjectId(id) ? id : undefined;
}

/**
 * Move a legacy in-project `.axa/` directory into the project management folder,
 * then let refer write `project.ref` and the `<project>/.axa` symlink.
 */
export async function ensureManagedProject(project: ProjectConfig): Promise<void> {
  await mkdir(projectManageDir(project.id), { recursive: true });
  const linkPath = projectAxaDir(project.path);
  const managed = managedAxaDir(project.id);
  const state = await describeLink(linkPath);

  if (state.kind === "directory") {
    if (await pathExists(managed)) {
      throw new AxaError(
        "CONFIG_ERROR",
        `Both ${linkPath} and ${managed} contain .axa data; resolve the duplicate manually.`,
      );
    }
    await rename(linkPath, managed);
  } else if (state.kind === "file") {
    throw new AxaError("CONFIG_ERROR", `${linkPath} exists and is not a directory or symlink.`);
  } else if (state.kind === "symlink" && state.target !== resolve(managed)) {
    if (state.target && !(await pathExists(managed)) && isUnderProjectsRoot(state.target)) {
      // The registry id changed: keep the existing data under the new folder.
      await rename(state.target, managed);
    }
  }

  await mkdir(managed, { recursive: true });
  const existing = await readProjectRefState(project.id);
  const desired = resolveLocalReference(project.path, referSession());

  try {
    // refer owns the symlink semantics (repoint, .gitignore, force handling).
    applyRef("", managed, false, [linkPath], referSession());
  } catch (error) {
    throw toAxaError(error, `Cannot link ${linkPath} to ${managed}.`);
  }

  if (!existing || existing.project.path !== project.path || existing.remote !== desired.remote) {
    await writeProjectRef(project);
  }
}

/**
 * Write `project.ref` through refer's own "record a reference" flow.
 *
 * A git project is recorded with its origin remote, so `refer get` can clone
 * or check the project out again elsewhere. Everything else records the
 * `<project>/.axa` link into the management folder. Links are applied by
 * `ensureManagedProject`, so this only records the manifest.
 */
export async function writeProjectRef(project: ProjectConfig): Promise<void> {
  const manageDir = projectManageDir(project.id);
  await mkdir(manageDir, { recursive: true });
  const file = projectRefPath(project.id);
  const session = referSession();
  const resolved = resolveLocalReference(project.path, session);
  // Recreate the file so refer writes its canonical header instead of
  // preserving arbitrary comment lines.
  await rm(file, { force: true });
  try {
    if (resolved.remote !== "") {
      addRef({ file, remote: resolved.remote, local: resolved.local, apply: false }, session);
    } else {
      addRef(
        {
          file,
          local: AXA_DIR,
          symlinks: [projectAxaDir(project.path)],
          baseDir: manageDir,
          apply: false,
        },
        session,
      );
    }
  } catch (error) {
    throw toAxaError(error, `Cannot write ${file}.`);
  }
}

interface ProjectRefState {
  project: ProjectConfig;
  remote: string;
}

/** Read a project definition through refer's manifest reader. */
async function readProjectRefState(projectId: string): Promise<ProjectRefState | undefined> {
  const file = projectRefPath(projectId);
  const session = referSession();
  let manifest: RefManifest;
  let addedAt: string;
  try {
    manifest = readRef(file, session);
    addedAt = (await lstat(file)).mtime.toISOString();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof ReferError) return undefined;
    throw error;
  }

  // Git-backed manifests point at the project checkout; local-only ones point
  // at the managed `.axa` folder through the link they create.
  const link = manifest.symlinks[0];
  const projectPath =
    manifest.remote !== ""
      ? resolve(projectManageDir(projectId), expandPath(manifest.local, session.env))
      : link === undefined
        ? undefined
        : dirname(expandPath(link, session.env));
  if (projectPath === undefined) return undefined;

  return {
    remote: manifest.remote,
    project: {
      id: projectId,
      name: basename(projectPath),
      path: projectPath,
      addedAt,
    },
  };
}

export async function readProjectRef(projectId: string): Promise<ProjectConfig | undefined> {
  return (await readProjectRefState(projectId))?.project;
}

/** The project registry is the set of management folders that hold a `project.ref`. */
export async function listProjectRefs(): Promise<ProjectConfig[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(getProjectsRoot(), { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: ProjectConfig[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isProjectId(entry.name)) continue;
    const project = await readProjectRef(entry.name);
    if (project) projects.push(project);
  }
  return projects.sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

/** Unregister a project while keeping its task data on disk. */
export async function removeProjectRef(projectId: string): Promise<void> {
  await rm(projectRefPath(projectId), { force: true });
}

/**
 * Restore a managed project checkout that is missing on this machine.
 *
 * `$AXA_HOME` carries the registry (`project.ref`) and the task data, but not
 * the project working tree. When the tree is gone — e.g. after copying the
 * folder to another machine — replay the manifest to clone/check it out again,
 * then rebuild the `<project>/.axa` link. Local-only references cannot be
 * restored automatically and are reported as such.
 */
export async function restoreProject(projectId: string): Promise<ProjectConfig> {
  const project = await readProjectRef(projectId);
  if (!project) {
    throw new AxaError("NOT_FOUND", `Project is not registered: ${projectId}`);
  }
  if (await isAxaProject(project.path)) return project;

  const file = projectRefPath(projectId);
  const session = referSession();
  let manifest: RefManifest;
  try {
    manifest = readRef(file, session);
  } catch (error) {
    throw toAxaError(error, `Cannot read ${file}.`);
  }
  if (manifest.remote === "") {
    throw new AxaError(
      "INVALID_PROJECT",
      `Project ${projectId} has no git remote in ${file}; copy its files to ${project.path} manually.`,
    );
  }

  try {
    // Materialize the checkout only. `.axa` is re-linked below, once the
    // project directory exists again.
    replayRef(file, false, session, { baseDir: projectManageDir(projectId), link: false });
  } catch (error) {
    throw toAxaError(error, `Cannot restore project ${projectId} into ${project.path}.`);
  }

  await ensureManagedProject(project);
  return (await readProjectRef(projectId)) ?? project;
}
