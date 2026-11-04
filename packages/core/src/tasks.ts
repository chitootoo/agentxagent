import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { AxaError } from "./errors.js";
import {
  buildTaskFilename,
  canonicalTaskId,
  humanizeDescription,
  isoDate,
  isTaskPriority,
  parseTaskDocument,
  parseTaskFilename,
  serializeTaskDocument,
  slugifyTitle,
  stringArray,
  stringValue,
} from "./frontmatter.js";
import { writeFileAtomic } from "./fs-utils.js";
import { defaultInstruction } from "./instruction.js";
import { projectLockPath, withLock } from "./lock.js";
import {
  assertAxaProject,
  ensureTaskDirs,
  instructionPath,
  isAxaProject,
  pathExists,
  readProjectInfo,
  resolveProjectRoot,
  statusDir,
} from "./paths.js";
import type {
  ClaimTaskInput,
  CreateTaskInput,
  InitProjectOptions,
  ListTasksOptions,
  ProjectInfo,
  ReclaimStaleResult,
  Task,
  TaskIssue,
  TaskPriority,
  TaskStatus,
} from "./types.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "./types.js";

const CORE_FRONTMATTER_KEYS = new Set([
  "id",
  "title",
  "priority",
  "status",
  "created_at",
  "updated_at",
  "claimed_by",
  "claimed_at",
  "tags",
]);

function priorityRank(priority: TaskPriority): number {
  return TASK_PRIORITIES.indexOf(priority);
}

function sortTasks(tasks: Task[]): Task[] {
  return tasks.sort((a, b) => {
    const priority = priorityRank(a.priority) - priorityRank(b.priority);
    if (priority !== 0) return priority;
    return Number.parseInt(a.id, 10) - Number.parseInt(b.id, 10);
  });
}

function extractExtra(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !CORE_FRONTMATTER_KEYS.has(key)),
  );
}

export async function readTaskFile(
  filePath: string,
  projectRoot: string,
  status: TaskStatus,
): Promise<Task> {
  const filename = basename(filePath);
  const parsedName = parseTaskFilename(filename);
  if (!parsedName) {
    throw new AxaError(
      "INVALID_TASK",
      `Task filename must follow [id]_[priority]_[description].md: ${filename}`,
    );
  }

  const [content, fileStat] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
  const document = parseTaskDocument(content);
  const data = document.data;
  const title = stringValue(data.title) ?? humanizeDescription(parsedName.description);
  const priority = isTaskPriority(data.priority) ? data.priority : parsedName.priority;
  const claimedBy = stringValue(data.claimed_by);
  const claimedAt = isoDateIfPresent(data.claimed_at);
  const fallbackDate = fileStat.mtime;

  return {
    id: parsedName.id,
    title,
    priority,
    status,
    body: document.body,
    filename,
    filePath,
    projectRoot,
    ...(claimedBy ? { claimedBy } : {}),
    ...(claimedAt ? { claimedAt } : {}),
    createdAt: isoDate(
      data.created_at,
      fileStat.birthtimeMs > 0 ? fileStat.birthtime : fallbackDate,
    ),
    updatedAt: isoDate(data.updated_at, fallbackDate),
    tags: stringArray(data.tags),
    extra: extractExtra(data),
  };
}

function isoDateIfPresent(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

async function readStatusTasks(
  projectRoot: string,
  status: TaskStatus,
): Promise<{ tasks: Task[]; issues: TaskIssue[] }> {
  let filenames: string[];
  try {
    const entries = await readdir(statusDir(projectRoot, status), { withFileTypes: true });
    filenames = entries
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."),
      )
      .map((entry) => entry.name);
  } catch {
    return { tasks: [], issues: [] };
  }

  const tasks: Task[] = [];
  const issues: TaskIssue[] = [];
  for (const filename of filenames) {
    if (!parseTaskFilename(filename)) {
      continue;
    }
    const filePath = join(statusDir(projectRoot, status), filename);
    try {
      tasks.push(await readTaskFile(filePath, projectRoot, status));
    } catch (error) {
      issues.push({
        filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { tasks, issues };
}

export async function scanTasks(
  projectRoot: string,
  options: ListTasksOptions = {},
): Promise<{ tasks: Task[]; issues: TaskIssue[] }> {
  await assertAxaProject(projectRoot);
  const statuses = options.statuses ?? TASK_STATUSES;
  const results = await Promise.all(statuses.map((status) => readStatusTasks(projectRoot, status)));
  const tasks = results.flatMap((result) => result.tasks);
  const filtered = tasks.filter(
    (task) =>
      (!options.priority || task.priority === options.priority) &&
      (!options.claimedBy || task.claimedBy === options.claimedBy),
  );
  return {
    tasks: sortTasks(filtered),
    issues: results.flatMap((result) => result.issues),
  };
}

export async function listTasks(
  projectRoot: string,
  options: ListTasksOptions = {},
): Promise<Task[]> {
  return (await scanTasks(projectRoot, options)).tasks;
}

async function findTaskLocation(
  projectRoot: string,
  rawTaskId: string,
): Promise<{ task: Task; status: TaskStatus; filename: string }> {
  const filenameMatch = parseTaskFilename(rawTaskId);
  const id = filenameMatch?.id ?? canonicalTaskId(rawTaskId);
  const matches: Array<{ task: Task; status: TaskStatus; filename: string }> = [];

  for (const status of TASK_STATUSES) {
    let filenames: string[];
    try {
      filenames = (await readdir(statusDir(projectRoot, status), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const filename of filenames) {
      const parsed = parseTaskFilename(filename);
      if (!parsed || parsed.id !== id) continue;
      const task = await readTaskFile(
        join(statusDir(projectRoot, status), filename),
        projectRoot,
        status,
      );
      matches.push({ task, status, filename });
    }
  }

  if (matches.length === 0) {
    throw new AxaError("NOT_FOUND", `Task ${rawTaskId} was not found in this project.`);
  }
  if (matches.length > 1) {
    throw new AxaError(
      "CONFLICT",
      `Task id ${id} exists in multiple states. Keep exactly one file per task id.`,
    );
  }
  return matches[0] as { task: Task; status: TaskStatus; filename: string };
}

export async function getTask(projectRoot: string, taskId: string): Promise<Task> {
  await assertAxaProject(projectRoot);
  return (await findTaskLocation(projectRoot, taskId)).task;
}

function taskFrontmatter(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    status: task.status,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    ...(task.claimedBy ? { claimed_by: task.claimedBy } : {}),
    ...(task.claimedAt ? { claimed_at: task.claimedAt } : {}),
    ...(task.tags.length > 0 ? { tags: task.tags } : {}),
    ...task.extra,
  };
}

async function persistAndMove(
  task: Task,
  nextStatus: TaskStatus,
  projectRoot: string,
  mutate?: (next: Task) => void,
): Promise<Task> {
  const nextTask: Task = { ...task, status: nextStatus, updatedAt: new Date().toISOString() };
  mutate?.(nextTask);

  const destination = join(statusDir(projectRoot, nextStatus), task.filename);
  if (destination !== task.filePath && (await pathExists(destination))) {
    throw new AxaError("CONFLICT", `A task file already exists at ${destination}.`);
  }

  const content = serializeTaskDocument(taskFrontmatter(nextTask), nextTask.body);
  await writeFileAtomic(task.filePath, content);
  if (destination !== task.filePath) {
    await ensureTaskDirs(projectRoot);
    await rename(task.filePath, destination);
  }
  return readTaskFile(destination, projectRoot, nextStatus);
}

async function nextTaskId(projectRoot: string): Promise<string> {
  let highest = 0;
  for (const status of TASK_STATUSES) {
    try {
      const entries = await readdir(statusDir(projectRoot, status));
      for (const entry of entries) {
        const id = Number.parseInt(entry.split("_")[0] ?? "", 10);
        if (Number.isSafeInteger(id) && id > highest) highest = id;
      }
    } catch {
      // Directory may not exist yet.
    }
  }
  return String(highest + 1).padStart(3, "0");
}

export async function initProject(options: InitProjectOptions): Promise<ProjectInfo> {
  const projectRoot = resolve(options.projectRoot);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(projectRoot, ".axa"), { recursive: true });
  await ensureTaskDirs(projectRoot);
  const instruction = instructionPath(projectRoot);
  if (!(await pathExists(instruction))) {
    await writeFileAtomic(instruction, defaultInstruction(options.name ?? basename(projectRoot)));
  }
  return readProjectInfo(projectRoot);
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const projectRoot = resolve(input.projectRoot);
  await assertAxaProject(projectRoot);
  const title = input.title.trim();
  if (!title) {
    throw new AxaError("INVALID_TASK", "Task title cannot be empty.");
  }
  if (title.length > 300) {
    throw new AxaError("INVALID_TASK", "Task title must be 300 characters or fewer.");
  }

  const priority = input.priority ?? "P1";
  const status = input.status ?? "backlog";
  if (!isTaskPriority(priority)) {
    throw new AxaError("INVALID_TASK", `Invalid priority: ${priority}`);
  }
  if (status !== "backlog" && status !== "todo") {
    throw new AxaError("INVALID_TASK", "New tasks can only be created in backlog or todo.");
  }

  return withLock(projectLockPath(projectRoot), async () => {
    await ensureTaskDirs(projectRoot);
    const now = new Date().toISOString();
    let id = await nextTaskId(projectRoot);
    let filename = buildTaskFilename(id, priority, title);
    while (await pathExists(join(statusDir(projectRoot, status), filename))) {
      id = String(Number.parseInt(id, 10) + 1).padStart(3, "0");
      filename = buildTaskFilename(id, priority, title);
    }

    const task: Task = {
      id,
      title,
      priority,
      status,
      body: input.body?.trim() ?? "",
      filename,
      filePath: join(statusDir(projectRoot, status), filename),
      projectRoot,
      createdAt: now,
      updatedAt: now,
      tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      extra: input.actor ? { created_by: input.actor } : {},
    };
    await writeFileAtomic(task.filePath, serializeTaskDocument(taskFrontmatter(task), task.body));
    return readTaskFile(task.filePath, projectRoot, status);
  });
}

export async function approveTask(
  projectRoot: string,
  taskId: string,
  actor?: string,
): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withLock(projectLockPath(projectRoot), async () => {
    const { task, status } = await findTaskLocation(projectRoot, taskId);
    if (status !== "backlog") {
      throw new AxaError("INVALID_STATE", `Task ${task.id} is ${status}, not backlog.`);
    }
    return persistAndMove(task, "todo", projectRoot, (next) => {
      if (actor) {
        next.extra = { ...next.extra, approved_by: actor, approved_at: new Date().toISOString() };
      }
    });
  });
}

export async function claimTask(input: ClaimTaskInput): Promise<Task> {
  const projectRoot = resolve(input.projectRoot);
  await assertAxaProject(projectRoot);
  const agent = input.agent.trim();
  if (!agent) {
    throw new AxaError("INVALID_TASK", "An agent name is required to claim a task.");
  }

  return withLock(projectLockPath(projectRoot), async () => {
    let taskId = input.taskId;
    if (!taskId && input.next) {
      const { tasks } = await scanTasks(projectRoot, { statuses: ["todo"] });
      const first = tasks[0];
      if (!first) {
        throw new AxaError("NOT_FOUND", "There are no todo tasks available to claim.");
      }
      taskId = first.id;
    }
    if (!taskId) {
      throw new AxaError("INVALID_TASK", "Provide a task id or use claim --next.");
    }

    const { task, status } = await findTaskLocation(projectRoot, taskId);
    if (status === "doing") {
      throw new AxaError(
        "ALREADY_CLAIMED",
        `Task ${task.id} is already claimed by ${task.claimedBy ?? "another agent"}.`,
      );
    }
    if (status !== "todo") {
      throw new AxaError(
        "INVALID_STATE",
        `Task ${task.id} is ${status}; only todo tasks can be claimed.`,
      );
    }

    return persistAndMove(task, "doing", projectRoot, (next) => {
      next.claimedBy = agent;
      next.claimedAt = new Date().toISOString();
    });
  });
}

export async function releaseTask(projectRoot: string, taskId: string): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withLock(projectLockPath(projectRoot), async () => {
    const { task, status } = await findTaskLocation(projectRoot, taskId);
    if (status !== "doing") {
      throw new AxaError(
        "INVALID_STATE",
        `Task ${task.id} is ${status}; only doing tasks can be released.`,
      );
    }
    return persistAndMove(task, "todo", projectRoot, (next) => {
      delete next.claimedBy;
      delete next.claimedAt;
    });
  });
}

export async function completeTask(
  projectRoot: string,
  taskId: string,
  actor?: string,
): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withLock(projectLockPath(projectRoot), async () => {
    const { task, status } = await findTaskLocation(projectRoot, taskId);
    if (status !== "doing") {
      throw new AxaError(
        "INVALID_STATE",
        `Task ${task.id} is ${status}; only doing tasks can be completed.`,
      );
    }
    return persistAndMove(task, "done", projectRoot, (next) => {
      next.extra = {
        ...next.extra,
        completed_at: new Date().toISOString(),
        completed_by: actor ?? next.claimedBy ?? "unknown",
      };
    });
  });
}

export async function reclaimStaleTasks(
  projectRoot: string,
  olderThanMs: number,
): Promise<ReclaimStaleResult> {
  await assertAxaProject(projectRoot);
  if (!Number.isFinite(olderThanMs) || olderThanMs <= 0) {
    throw new AxaError("INVALID_TASK", "olderThanMs must be a positive number.");
  }

  return withLock(projectLockPath(projectRoot), async () => {
    const { tasks } = await scanTasks(projectRoot, { statuses: ["doing"] });
    const now = Date.now();
    const reclaimed: Task[] = [];
    let skipped = 0;

    for (const task of tasks) {
      const claimedAt = task.claimedAt ? new Date(task.claimedAt).getTime() : Number.NaN;
      if (!Number.isFinite(claimedAt) || now - claimedAt < olderThanMs) {
        skipped += 1;
        continue;
      }
      const released = await persistAndMove(task, "todo", projectRoot, (next) => {
        delete next.claimedBy;
        delete next.claimedAt;
      });
      reclaimed.push(released);
    }

    return { reclaimed, skipped };
  });
}

export async function resolveProject(projectRoot?: string): Promise<string> {
  return resolveProjectRoot(projectRoot);
}

export async function ensureProject(projectRoot: string): Promise<boolean> {
  return isAxaProject(projectRoot);
}

export async function writeTaskBody(
  projectRoot: string,
  taskId: string,
  body: string,
): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withLock(projectLockPath(projectRoot), async () => {
    const { task } = await findTaskLocation(projectRoot, taskId);
    const next: Task = { ...task, body, updatedAt: new Date().toISOString() };
    await writeFile(task.filePath, serializeTaskDocument(taskFrontmatter(next), body), "utf8");
    return readTaskFile(task.filePath, projectRoot, task.status);
  });
}

export { slugifyTitle };
