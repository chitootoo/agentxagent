import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { AxaError } from "./errors.js";
import type { ProjectInfo, TaskStatus } from "./types.js";
import { TASK_STATUSES } from "./types.js";

export const AXA_DIR = ".axa";
export const TASKS_DIR = "tasks";
export const INSTRUCTION_FILE = "instruction.md";

export function projectAxaDir(projectRoot: string): string {
  return join(projectRoot, AXA_DIR);
}

export function statusDir(projectRoot: string, status: TaskStatus): string {
  return join(projectAxaDir(projectRoot), TASKS_DIR, status);
}

export function instructionPath(projectRoot: string): string {
  return join(projectAxaDir(projectRoot), INSTRUCTION_FILE);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function isAxaProject(projectRoot: string): Promise<boolean> {
  return isDirectory(projectAxaDir(projectRoot));
}

export async function assertAxaProject(projectRoot: string): Promise<void> {
  if (!(await isAxaProject(projectRoot))) {
    throw new AxaError(
      "INVALID_PROJECT",
      `${projectRoot} is not an axa project. Run "axa init" there first.`,
    );
  }
}

export async function findProjectRoot(startPath: string): Promise<string | undefined> {
  let current = resolve(startPath);
  while (true) {
    if (await isAxaProject(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export async function resolveProjectRoot(input?: string): Promise<string> {
  if (input) {
    const candidate = toAbsolutePath(input);
    if (basename(candidate) === AXA_DIR) {
      const root = dirname(candidate);
      await assertAxaProject(root);
      return root;
    }
    if (await isAxaProject(candidate)) {
      return candidate;
    }
    if (!(await pathExists(candidate))) {
      throw new AxaError("INVALID_PROJECT", `Project path does not exist: ${candidate}`);
    }
    throw new AxaError(
      "INVALID_PROJECT",
      `${candidate} is not an axa project (missing .axa/ directory).`,
    );
  }

  const found = await findProjectRoot(process.cwd());
  if (!found) {
    throw new AxaError(
      "INVALID_PROJECT",
      'No .axa/ directory found here or in a parent directory. Run "axa init" first.',
    );
  }
  return found;
}

export async function ensureTaskDirs(projectRoot: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await Promise.all(
    TASK_STATUSES.map((status) => mkdir(statusDir(projectRoot, status), { recursive: true })),
  );
}

export async function readProjectInfo(projectRoot: string): Promise<ProjectInfo> {
  await assertAxaProject(projectRoot);
  const counts = { backlog: 0, todo: 0, doing: 0, done: 0 } satisfies Record<TaskStatus, number>;

  await Promise.all(
    TASK_STATUSES.map(async (status) => {
      try {
        const entries = await readdir(statusDir(projectRoot, status), { withFileTypes: true });
        counts[status] = entries.filter(
          (entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."),
        ).length;
      } catch {
        counts[status] = 0;
      }
    }),
  );

  const total = TASK_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  return {
    name: basename(projectRoot),
    path: projectRoot,
    axaPath: projectAxaDir(projectRoot),
    instructionPath: instructionPath(projectRoot),
    counts,
    total,
  };
}

export function expandHomePath(input: string): string {
  const path = input.trim();
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function toAbsolutePath(input: string, cwd = process.cwd()): string {
  return resolve(cwd, expandHomePath(input));
}
