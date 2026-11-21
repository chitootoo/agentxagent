import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { open, readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { AxaError } from "./errors.js";
import {
  booleanValue,
  buildMessageFilename,
  buildTaskFilename,
  buildTaskFolderName,
  canonicalTaskId,
  humanizeDescription,
  isoDate,
  isTaskPriority,
  parseMessageFilename,
  parseTaskDocument,
  parseTaskFilename,
  parseTaskFolderName,
  serializeTaskDocument,
  slugifyTitle,
  stringArray,
  stringValue,
} from "./frontmatter.js";
import { writeFileAtomic } from "./fs-utils.js";
import { defaultInstruction, defaultTasksReadme } from "./instruction.js";
import { withLock } from "./lock.js";
import {
  assertAxaProject,
  ensureTaskDirs,
  isAxaProject,
  pathExists,
  projectAxaDir,
  readProjectInfo,
  resolveProjectRoot,
  skillPath,
  statusDir,
  tasksReadmePath,
} from "./paths.js";
import type {
  AppendTaskMessageInput,
  ClaimTaskInput,
  ConversationEntry,
  CreateTaskInput,
  InitProjectOptions,
  ListTasksOptions,
  MaintenanceResult,
  ProjectInfo,
  ReleaseStaleResult,
  ReleaseTaskOptions,
  Task,
  TaskIssue,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from "./types.js";
import { ACTIVE_TASK_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "./types.js";

export const TASK_METADATA_FILE = "task.json";
export const TASK_LOCK_FILE = ".lock";
export const STALE_CLAIM_MS = 7 * 24 * 60 * 60 * 1000;
export const ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const TASK_LOCK_TIMEOUT_MS = 10_000;
const TASK_LOCK_STALE_MS = 30_000;

const CORE_FRONTMATTER_KEYS = new Set([
  "id",
  "title",
  "priority",
  "status",
  "created_at",
  "updated_at",
  "claimed_by",
  "claimed_at",
  "review_required",
  "tags",
]);

const CORE_METADATA_KEYS = new Set([
  "version",
  "id",
  "title",
  "priority",
  "status",
  "created_at",
  "updated_at",
  "createdAt",
  "updatedAt",
  "claimed_by",
  "claimedAt",
  "claimedBy",
  "review_required",
  "reviewRequired",
  "tags",
  "extra",
]);

interface TaskMetadata {
  version: 1;
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  reviewRequired: boolean;
  createdAt: string;
  updatedAt: string;
  claimedBy?: string;
  claimedAt?: string;
  tags: string[];
  extra: Record<string, unknown>;
}

function priorityRank(priority: TaskPriority): number {
  return TASK_PRIORITIES.indexOf(priority);
}

const AGENT_PLATFORM_PATTERN = /[^a-z0-9-]+/gu;

/** Mint a per-round agent id: `{platform}_{yy-MM-dd_HH:mm:ss.SSS}`. */
export function buildAgentId(platform: string, at: Date = new Date()): string {
  const clean =
    platform
      .trim()
      .toLowerCase()
      .replace(AGENT_PLATFORM_PATTERN, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 32) || "agent";
  const pad = (value: number) => String(value).padStart(2, "0");
  const millis = String(at.getMilliseconds()).padStart(3, "0");
  return `${clean}_${pad(at.getFullYear() % 100)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${millis}`;
}

function claimedByMatches(claimedBy: string | undefined, filter: string): boolean {
  if (!claimedBy) return false;
  const value = filter.trim();
  return claimedBy === value || claimedBy.startsWith(`${value}_`);
}

function sortTasks(tasks: Task[]): Task[] {
  return tasks.sort((a, b) => {
    const priority = priorityRank(a.priority) - priorityRank(b.priority);
    if (priority !== 0) return priority;
    return Number.parseInt(a.id, 10) - Number.parseInt(b.id, 10);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractExtra(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !CORE_FRONTMATTER_KEYS.has(key)),
  );
}

function extractMetadataExtra(data: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = isRecord(data.extra) ? { ...data.extra } : {};
  for (const [key, value] of Object.entries(data)) {
    if (!CORE_METADATA_KEYS.has(key) && value != null) {
      extra[key] = value;
    }
  }
  return sanitizeExtra(extra);
}

function sanitizeExtra(extra: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(extra).filter(
      ([key, value]) => !CORE_FRONTMATTER_KEYS.has(key) && value != null,
    ),
  );
}

function isoDateIfPresent(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

const GENERIC_MESSAGE_TITLES = new Set([
  "本轮实现",
  "本轮完成",
  "本轮总结",
  "实现",
  "完成",
  "总结",
  "方案评估",
  "评估",
  "变更",
  "修改",
  "更新",
  "修复",
  "说明",
  "交付",
  "summary",
  "implementation",
  "changes",
  "done",
  "completed",
  "evaluation",
  "review",
  "update",
  "fix",
  "delivery",
]);

function normalizeTitleKey(title: string): string {
  return title.replace(/[\s:：,，.。!！?？;；_-]+/gu, "").toLowerCase();
}

function isGenericMessageTitle(title: string): boolean {
  return GENERIC_MESSAGE_TITLES.has(normalizeTitleKey(title));
}

function firstSentence(text: string): string {
  const [sentence = text] = text.split(/(?<=[。！？!?])\s*/u);
  if (sentence.length <= 40) {
    return sentence.trim();
  }
  const clipped = sentence.slice(0, 40);
  const boundary = Math.max(
    clipped.lastIndexOf("，"),
    clipped.lastIndexOf("："),
    clipped.lastIndexOf("；"),
    clipped.lastIndexOf(", "),
    clipped.lastIndexOf(" "),
  );
  return (boundary >= 12 ? clipped.slice(0, boundary) : clipped).trim();
}

function defaultConversationTitle(body: string, fallback: string): string {
  let candidate: string | undefined;
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*$/u.exec(line);
    const text = (heading?.[1] ?? line)
      .replace(/^[>*_\-\s]+/u, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!text || isGenericMessageTitle(text)) continue;
    candidate = text;
    break;
  }
  return slugifyTitle(firstSentence(candidate ?? fallback));
}

function taskMetadata(task: Task): TaskMetadata {
  return {
    version: 1,
    id: task.id,
    title: task.title,
    priority: task.priority,
    status: task.status,
    reviewRequired: task.reviewRequired,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.claimedBy ? { claimedBy: task.claimedBy } : {}),
    ...(task.claimedAt ? { claimedAt: task.claimedAt } : {}),
    tags: task.tags,
    extra: task.extra,
  };
}

function serializeMetadata(task: Task): string {
  return `${JSON.stringify(taskMetadata(task), null, 2)}\n`;
}

async function readConversation(dirPath: string): Promise<ConversationEntry[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const conversation: ConversationEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = parseMessageFilename(entry.name);
    if (!parsed) continue;
    const filePath = join(dirPath, entry.name);
    const document = parseTaskDocument(await readFile(filePath, "utf8"));
    const agent = stringValue(document.data.agent);
    conversation.push({
      seq: parsed.seq,
      role: parsed.role,
      title: parsed.title,
      filename: entry.name,
      filePath,
      body: document.body,
      ...(agent && parsed.role === "agent" ? { agent } : {}),
    });
  }
  return conversation.sort((a, b) => a.seq.localeCompare(b.seq));
}

function latestUserBody(conversation: ConversationEntry[]): string {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const entry = conversation[index];
    if (entry?.role === "user") return entry.body;
  }
  return "";
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
  const claimedBy = stringValue(data.claimed_by);
  const claimedAt = isoDateIfPresent(data.claimed_at);
  const fallbackDate = fileStat.mtime;

  return {
    id: parsedName.id,
    title,
    priority: parsedName.priority,
    status,
    body: document.body,
    filename,
    filePath,
    metadataPath: filePath,
    projectRoot,
    reviewRequired: booleanValue(data.review_required) ?? true,
    ...(claimedBy ? { claimedBy } : {}),
    ...(claimedAt ? { claimedAt } : {}),
    createdAt: isoDate(
      data.created_at,
      fileStat.birthtimeMs > 0 ? fileStat.birthtime : fallbackDate,
    ),
    updatedAt: isoDate(data.updated_at, fallbackDate),
    tags: stringArray(data.tags),
    extra: extractExtra(data),
    conversation: [],
    legacy: true,
  };
}

async function readTaskFolder(
  dirPath: string,
  projectRoot: string,
  status: TaskStatus,
): Promise<Task> {
  const filename = basename(dirPath);
  const parsedName = parseTaskFolderName(filename);
  if (!parsedName) {
    throw new AxaError(
      "INVALID_TASK",
      `Task directory must follow [id]_[priority]_[description]: ${filename}`,
    );
  }

  const metadataPath = join(dirPath, TASK_METADATA_FILE);
  const [raw, dirStat] = await Promise.all([readFile(metadataPath, "utf8"), stat(dirPath)]);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (cause) {
    throw new AxaError("INVALID_TASK", `Task metadata is not valid JSON: ${metadataPath}`, {
      cause,
    });
  }
  if (!isRecord(data)) {
    throw new AxaError("INVALID_TASK", `Task metadata must be a JSON object: ${metadataPath}`);
  }

  const conversation = await readConversation(dirPath);
  const title = stringValue(data.title) ?? humanizeDescription(parsedName.description);
  const claimedBy = stringValue(data.claimedBy) ?? stringValue(data.claimed_by);
  const claimedAt = isoDateIfPresent(data.claimedAt) ?? isoDateIfPresent(data.claimed_at);
  const fallbackDate = dirStat.mtime;

  return {
    id: parsedName.id,
    title,
    priority: isTaskPriority(data.priority) ? data.priority : parsedName.priority,
    status,
    body: latestUserBody(conversation),
    filename,
    filePath: dirPath,
    metadataPath,
    projectRoot,
    reviewRequired: booleanValue(data.reviewRequired) ?? booleanValue(data.review_required) ?? true,
    ...(claimedBy ? { claimedBy } : {}),
    ...(claimedAt ? { claimedAt } : {}),
    createdAt: isoDate(
      data.createdAt ?? data.created_at,
      dirStat.birthtimeMs > 0 ? dirStat.birthtime : fallbackDate,
    ),
    updatedAt: isoDate(data.updatedAt ?? data.updated_at, fallbackDate),
    tags: stringArray(data.tags),
    extra: extractMetadataExtra(data),
    conversation,
    legacy: false,
  };
}

async function readTaskEntry(
  entry: Dirent,
  dirPath: string,
  projectRoot: string,
  status: TaskStatus,
): Promise<Task | undefined> {
  if (entry.name.startsWith(".")) return undefined;
  if (entry.isDirectory()) {
    if (!parseTaskFolderName(entry.name)) return undefined;
    return readTaskFolder(join(dirPath, entry.name), projectRoot, status);
  }
  if (entry.isFile() && entry.name.endsWith(".md")) {
    if (!parseTaskFilename(entry.name)) return undefined;
    return readTaskFile(join(dirPath, entry.name), projectRoot, status);
  }
  return undefined;
}

async function readStatusTasks(
  projectRoot: string,
  status: TaskStatus,
): Promise<{ tasks: Task[]; issues: TaskIssue[] }> {
  let entries: Dirent[];
  try {
    entries = await readdir(statusDir(projectRoot, status), { withFileTypes: true });
  } catch {
    return { tasks: [], issues: [] };
  }

  const tasks: Task[] = [];
  const issues: TaskIssue[] = [];
  for (const entry of entries) {
    const filePath = join(statusDir(projectRoot, status), entry.name);
    try {
      const task = await readTaskEntry(entry, statusDir(projectRoot, status), projectRoot, status);
      if (task) tasks.push(task);
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
  const statuses =
    options.statuses ?? (options.includeArchived ? TASK_STATUSES : ACTIVE_TASK_STATUSES);
  const results = await Promise.all(statuses.map((status) => readStatusTasks(projectRoot, status)));
  const tasks = results.flatMap((result) => result.tasks);
  const filtered = tasks.filter(
    (task) =>
      (!options.priority || task.priority === options.priority) &&
      (!options.claimedBy || claimedByMatches(task.claimedBy, options.claimedBy)),
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
  const filenameMatch = parseTaskFilename(rawTaskId) ?? parseTaskFolderName(rawTaskId);
  const id = filenameMatch?.id ?? canonicalTaskId(rawTaskId);
  const matches: Array<{ task: Task; status: TaskStatus; filename: string }> = [];

  for (const status of TASK_STATUSES) {
    let entries: Dirent[];
    try {
      entries = await readdir(statusDir(projectRoot, status), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const parsed = entry.isDirectory()
        ? parseTaskFolderName(entry.name)
        : entry.isFile() && entry.name.endsWith(".md")
          ? parseTaskFilename(entry.name)
          : undefined;
      if (!parsed || parsed.id !== id) continue;
      const task = await readTaskEntry(entry, statusDir(projectRoot, status), projectRoot, status);
      if (!task) continue;
      matches.push({ task, status, filename: entry.name });
    }
  }

  if (matches.length === 0) {
    throw new AxaError("NOT_FOUND", `Task ${rawTaskId} was not found in this project.`);
  }
  if (matches.length > 1) {
    throw new AxaError(
      "CONFLICT",
      `Task id ${id} exists in multiple states. Keep exactly one task directory per id.`,
    );
  }
  return matches[0] as { task: Task; status: TaskStatus; filename: string };
}

export async function getTask(projectRoot: string, taskId: string): Promise<Task> {
  await assertAxaProject(projectRoot);
  return (await findTaskLocation(projectRoot, taskId)).task;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function legacyMigrationLockPath(projectRoot: string): string {
  return join(projectAxaDir(projectRoot), "tasks", ".migrate.lock");
}

export function createLockPath(projectRoot: string): string {
  return join(projectAxaDir(projectRoot), "tasks", ".create.lock");
}

interface TaskLock {
  token: string;
  agent: string;
  path: string;
}

interface TaskTransaction {
  readonly task: Task;
  readonly status: TaskStatus;
  move(nextStatus: TaskStatus, mutate?: (next: Task) => void): Promise<Task>;
  save(mutate: (next: Task) => void): Promise<Task>;
}

async function taskLockIsStale(lockPath: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(lockPath, "utf8")) as { acquiredAt?: number };
    return (
      typeof owner.acquiredAt === "number" && Date.now() - owner.acquiredAt > TASK_LOCK_STALE_MS
    );
  } catch {
    return false;
  }
}

async function acquireTaskLock(task: Task, agent: string): Promise<TaskLock> {
  const token = randomUUID();
  const startedAt = Date.now();
  let dirPath = task.filePath;

  while (true) {
    const lockPath = join(dirPath, TASK_LOCK_FILE);
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({ token, agent, pid: process.pid, acquiredAt: Date.now() }),
          "utf8",
        );
      } finally {
        await handle.close();
      }
      return { token, agent, path: lockPath };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        const location = await findTaskLocation(task.projectRoot, task.id);
        dirPath = location.task.filePath;
        continue;
      }
      if (code !== "EEXIST") throw error;
    }

    if (await taskLockIsStale(lockPath)) {
      try {
        await unlink(lockPath);
      } catch {
        // Another waiter already removed it.
      }
      continue;
    }

    if (Date.now() - startedAt > TASK_LOCK_TIMEOUT_MS) {
      throw new AxaError(
        "LOCK_TIMEOUT",
        `Timed out waiting for ${lockPath}. Another agent is editing this task.`,
      );
    }
    await sleep(20 + Math.floor(Math.random() * 30));
  }
}

async function releaseTaskLock(lock: TaskLock): Promise<void> {
  try {
    const owner = JSON.parse(await readFile(lock.path, "utf8")) as { token?: string };
    if (owner.token === lock.token) {
      await unlink(lock.path);
    }
  } catch {
    // The task folder may already be gone.
  }
}

async function withTaskLock<T>(
  projectRoot: string,
  rawTaskId: string,
  actor: string | undefined,
  run: (tx: TaskTransaction) => Promise<T>,
): Promise<T> {
  const root = resolve(projectRoot);
  await assertAxaProject(root);

  let location = await findTaskLocation(root, rawTaskId);
  if (location.task.legacy) {
    await withLock(legacyMigrationLockPath(root), async () => {
      const fresh = await findTaskLocation(root, rawTaskId);
      if (fresh.task.legacy) {
        await migrateLegacyTask(fresh.task);
      }
    });
    location = await findTaskLocation(root, rawTaskId);
  }

  const lock = await acquireTaskLock(location.task, actor?.trim() || "console");
  try {
    const current = await findTaskLocation(root, rawTaskId);
    let task = current.task;
    let status = current.status;

    const move = async (nextStatus: TaskStatus, mutate?: (next: Task) => void): Promise<Task> => {
      const nextTask: Task = { ...task, status: nextStatus, updatedAt: new Date().toISOString() };
      mutate?.(nextTask);

      const destination = join(statusDir(root, nextStatus), nextTask.filename);
      if (destination !== task.filePath && (await pathExists(destination))) {
        throw new AxaError("CONFLICT", `A task directory already exists at ${destination}.`);
      }

      await writeFileAtomic(join(task.filePath, TASK_METADATA_FILE), serializeMetadata(nextTask));
      if (destination !== task.filePath) {
        await ensureTaskDirs(root);
        await rename(task.filePath, destination);
        lock.path = join(destination, TASK_LOCK_FILE);
      }

      task = await readTaskFolder(destination, root, nextStatus);
      status = nextStatus;
      return task;
    };

    const tx: TaskTransaction = {
      get task() {
        return task;
      },
      get status() {
        return status;
      },
      move,
      save: (mutate) => move(status, mutate),
    };
    return await run(tx);
  } finally {
    await releaseTaskLock(lock);
  }
}

async function migrateLegacyTask(task: Task): Promise<Task> {
  if (!task.legacy) return task;
  const folderName = task.filename.replace(/\.md$/u, "");
  const dirPath = join(statusDir(task.projectRoot, task.status), folderName);
  if (await pathExists(dirPath)) {
    throw new AxaError("CONFLICT", `A task directory already exists at ${dirPath}.`);
  }

  await import("node:fs/promises").then(({ mkdir }) => mkdir(dirPath, { recursive: true }));
  const messageFilename = buildMessageFilename("000", "user", task.title);
  if (task.body) {
    await writeFileAtomic(join(dirPath, messageFilename), `${task.body}\n`);
  } else {
    await writeFileAtomic(join(dirPath, messageFilename), "");
  }

  const migrated: Task = {
    ...task,
    filename: folderName,
    filePath: dirPath,
    metadataPath: join(dirPath, TASK_METADATA_FILE),
    legacy: false,
    conversation: [
      {
        seq: "000",
        role: "user",
        title: task.title,
        filename: messageFilename,
        filePath: join(dirPath, messageFilename),
        body: task.body,
      },
    ],
  };
  await writeFileAtomic(migrated.metadataPath, serializeMetadata(migrated));
  await unlink(task.filePath);
  return migrated;
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
  const name = options.name ?? basename(projectRoot);
  const skill = skillPath(projectRoot);
  if (!(await pathExists(skill))) {
    await writeFileAtomic(skill, defaultInstruction(name));
  }
  const readme = tasksReadmePath(projectRoot);
  if (!(await pathExists(readme))) {
    await writeFileAtomic(readme, defaultTasksReadme());
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

  return withLock(createLockPath(projectRoot), async () => {
    await ensureTaskDirs(projectRoot);
    const now = new Date().toISOString();
    let id = await nextTaskId(projectRoot);
    let filename = buildTaskFolderName(id, priority, title);
    while (await pathExists(join(statusDir(projectRoot, status), filename))) {
      id = String(Number.parseInt(id, 10) + 1).padStart(3, "0");
      filename = buildTaskFolderName(id, priority, title);
    }

    const body = input.body?.trim() ?? "";
    const messageFilename = buildMessageFilename("000", "user", title);
    const dirPath = join(statusDir(projectRoot, status), filename);
    const task: Task = {
      id,
      title,
      priority,
      status,
      body,
      filename,
      filePath: dirPath,
      metadataPath: join(dirPath, TASK_METADATA_FILE),
      projectRoot,
      reviewRequired: input.reviewRequired ?? true,
      createdAt: now,
      updatedAt: now,
      tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      extra: {
        ...(input.extra ? sanitizeExtra(input.extra) : {}),
        ...(input.actor ? { created_by: input.actor } : {}),
      },
      conversation: [
        {
          seq: "000",
          role: "user",
          title,
          filename: messageFilename,
          filePath: join(dirPath, messageFilename),
          body,
        },
      ],
      legacy: false,
    };

    await import("node:fs/promises").then(({ mkdir }) => mkdir(dirPath, { recursive: true }));
    await writeFileAtomic(
      task.conversation[0]?.filePath ?? join(dirPath, messageFilename),
      `${body}\n`,
    );
    await writeFileAtomic(task.metadataPath, serializeMetadata(task));
    return readTaskFolder(dirPath, projectRoot, status);
  });
}

async function updateLatestUserMessage(
  task: Task,
  body: string,
): Promise<{ conversation: ConversationEntry[]; messagePath: string }> {
  const conversation = [...task.conversation];
  const lastUserIndex = conversation.map((entry) => entry.role).lastIndexOf("user");
  if (lastUserIndex >= 0) {
    const entry = conversation[lastUserIndex] as ConversationEntry;
    const nextEntry: ConversationEntry = { ...entry, body };
    conversation[lastUserIndex] = nextEntry;
    await writeFileAtomic(entry.filePath, body ? `${body}\n` : "");
    return { conversation, messagePath: entry.filePath };
  }

  const seq = nextConversationSeq(conversation);
  const filename = buildMessageFilename(seq, "user", defaultConversationTitle(body, task.title));
  const filePath = join(task.filePath, filename);
  await writeFileAtomic(filePath, body ? `${body}\n` : "");
  conversation.push({
    seq,
    role: "user",
    title: humanizeDescription(defaultConversationTitle(body, task.title)),
    filename,
    filePath,
    body,
  });
  return { conversation, messagePath: filePath };
}

export async function updateTask(input: UpdateTaskInput): Promise<Task> {
  const projectRoot = resolve(input.projectRoot);
  await assertAxaProject(projectRoot);
  const title = input.title.trim();
  if (!title) {
    throw new AxaError("INVALID_TASK", "Task title cannot be empty.");
  }
  if (title.length > 300) {
    throw new AxaError("INVALID_TASK", "Task title must be 300 characters or fewer.");
  }
  if (input.priority && !isTaskPriority(input.priority)) {
    throw new AxaError("INVALID_TASK", `Invalid priority: ${input.priority}`);
  }

  return withTaskLock(projectRoot, input.taskId, undefined, async (tx) => {
    const { conversation } = await updateLatestUserMessage(tx.task, input.body.trim());
    return tx.move(tx.status, (next) => {
      next.title = title;
      next.body = input.body.trim();
      next.priority = input.priority ?? next.priority;
      next.reviewRequired = input.reviewRequired ?? next.reviewRequired;
      next.tags = input.tags ? input.tags.map((tag) => tag.trim()).filter(Boolean) : next.tags;
      next.extra = input.extra ? sanitizeExtra(input.extra) : next.extra;
      next.filename = buildTaskFolderName(next.id, next.priority, title);
      next.conversation = conversation;
    });
  });
}

function nextConversationSeq(conversation: ConversationEntry[]): string {
  const highest = conversation.reduce(
    (max, entry) => Math.max(max, Number.parseInt(entry.seq, 10) || 0),
    -1,
  );
  return String(highest + 1).padStart(3, "0");
}

export async function appendTaskMessage(input: AppendTaskMessageInput): Promise<Task> {
  const projectRoot = resolve(input.projectRoot);
  await assertAxaProject(projectRoot);
  const message = input.message.trim();
  if (!message) {
    throw new AxaError("INVALID_TASK", "Message cannot be empty.");
  }

  return withTaskLock(projectRoot, input.taskId, input.actor, async (tx) => {
    const requestedActor = input.actor?.trim() || undefined;
    let agent: string | undefined;
    if (input.role === "agent") {
      if (tx.status !== "doing") {
        throw new AxaError(
          "INVALID_STATE",
          `Task ${tx.task.id} is ${tx.status}; summaries can only be written while doing.`,
        );
      }
      agent = requestedActor ?? tx.task.claimedBy;
      if (!agent) {
        throw new AxaError(
          "INVALID_STATE",
          `Task ${tx.task.id} has no claimed agent; claim it before writing a summary.`,
        );
      }
      if (requestedActor && tx.task.claimedBy && tx.task.claimedBy !== requestedActor) {
        throw new AxaError(
          "FORBIDDEN",
          `Task ${tx.task.id} is claimed by ${tx.task.claimedBy}; ${requestedActor} cannot summarize it.`,
        );
      }
    }

    const seq = nextConversationSeq(tx.task.conversation);
    const title = input.title?.trim() || defaultConversationTitle(message, tx.task.title);
    const filename = buildMessageFilename(seq, input.role, title);
    const filePath = join(tx.task.filePath, filename);
    await writeFileAtomic(
      filePath,
      agent ? serializeTaskDocument({ agent }, message) : `${message}\n`,
    );

    const entry: ConversationEntry = {
      seq,
      role: input.role,
      title: humanizeDescription(slugifyTitle(title)),
      filename,
      filePath,
      body: message,
      ...(agent ? { agent } : {}),
    };
    const conversation: ConversationEntry[] = [...tx.task.conversation, entry];

    let nextStatus = tx.status;
    if (input.role === "user" && ["review", "done", "archived"].includes(tx.status)) {
      nextStatus = "todo";
    }

    return tx.move(nextStatus, (next) => {
      next.body = input.role === "user" ? message : next.body;
      next.conversation = conversation;
      const updatedBy = requestedActor ?? agent;
      next.extra = {
        ...next.extra,
        ...(updatedBy ? { updated_by: updatedBy } : {}),
      };
      if (nextStatus === "todo" && tx.status !== "todo") {
        delete next.claimedBy;
        delete next.claimedAt;
        const extra = { ...next.extra };
        for (const key of [
          "completed_at",
          "completed_by",
          "accepted_at",
          "accepted_by",
          "archived_at",
          "archived_by",
        ]) {
          delete extra[key];
        }
        next.extra = extra;
      }
    });
  });
}

export async function commentTask(
  projectRoot: string,
  taskId: string,
  message: string,
  actor?: string,
  title?: string,
): Promise<Task> {
  return appendTaskMessage({
    projectRoot,
    taskId,
    role: "user",
    message,
    ...(title ? { title } : {}),
    ...(actor ? { actor } : {}),
  });
}

export async function summarizeTask(
  projectRoot: string,
  taskId: string,
  message: string,
  actor?: string,
  title?: string,
): Promise<Task> {
  return appendTaskMessage({
    projectRoot,
    taskId,
    role: "agent",
    message,
    ...(title ? { title } : {}),
    ...(actor ? { actor } : {}),
  });
}

export async function deleteTask(projectRoot: string, taskId: string): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withTaskLock(projectRoot, taskId, undefined, async (tx) => {
    const task = tx.task;
    await rm(task.filePath, { recursive: true, force: true });
    return task;
  });
}

export async function approveTask(
  projectRoot: string,
  taskId: string,
  actor?: string,
): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withTaskLock(projectRoot, taskId, actor, async (tx) => {
    if (tx.status !== "backlog") {
      throw new AxaError("INVALID_STATE", `Task ${tx.task.id} is ${tx.status}, not backlog.`);
    }
    return tx.move("todo", (next) => {
      if (actor) {
        next.extra = { ...next.extra, approved_by: actor, approved_at: new Date().toISOString() };
      }
    });
  });
}

async function claimTaskById(
  projectRoot: string,
  taskId: string,
  agentPlatform: string,
): Promise<Task> {
  return withTaskLock(projectRoot, taskId, agentPlatform, async (tx) => {
    if (tx.status === "doing") {
      throw new AxaError(
        "ALREADY_CLAIMED",
        `Task ${tx.task.id} is already claimed by ${tx.task.claimedBy ?? "another agent"}.`,
      );
    }
    if (tx.status !== "todo") {
      throw new AxaError(
        "INVALID_STATE",
        `Task ${tx.task.id} is ${tx.status}; only todo tasks can be claimed.`,
      );
    }
    return tx.move("doing", (next) => {
      next.claimedBy = buildAgentId(agentPlatform);
      next.claimedAt = new Date().toISOString();
    });
  });
}

export async function claimTask(input: ClaimTaskInput): Promise<Task> {
  const projectRoot = resolve(input.projectRoot);
  await assertAxaProject(projectRoot);
  const agentPlatform = input.agentPlatform.trim();
  if (!agentPlatform) {
    throw new AxaError("INVALID_TASK", "An agent platform name is required to claim a task.");
  }

  if (!input.next) {
    if (!input.taskId) {
      throw new AxaError("INVALID_TASK", "Provide a task id or use claim --next.");
    }
    return claimTaskById(projectRoot, input.taskId, agentPlatform);
  }

  const { tasks } = await scanTasks(projectRoot, { statuses: ["todo"] });
  let lastError: AxaError | undefined;
  for (const candidate of tasks) {
    try {
      return await claimTaskById(projectRoot, candidate.id, agentPlatform);
    } catch (error) {
      if (
        error instanceof AxaError &&
        (error.code === "ALREADY_CLAIMED" || error.code === "INVALID_STATE")
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new AxaError("NOT_FOUND", "There are no todo tasks available to claim.");
}

export async function releaseTask(
  projectRoot: string,
  taskId: string,
  options: ReleaseTaskOptions = {},
): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withTaskLock(projectRoot, taskId, options.actor, async (tx) => {
    if (tx.status !== "doing") {
      throw new AxaError(
        "INVALID_STATE",
        `Task ${tx.task.id} is ${tx.status}; only doing tasks can be released.`,
      );
    }
    if (
      !options.force &&
      options.actor &&
      tx.task.claimedBy &&
      tx.task.claimedBy !== options.actor
    ) {
      throw new AxaError(
        "FORBIDDEN",
        `Task ${tx.task.id} is claimed by ${tx.task.claimedBy}; ${options.actor} cannot release it.`,
      );
    }
    return tx.move("todo", (next) => {
      delete next.claimedBy;
      delete next.claimedAt;
    });
  });
}

function hasAgentSummary(task: Task): boolean {
  return task.conversation.at(-1)?.role === "agent";
}

export async function completeTask(
  projectRoot: string,
  taskId: string,
  actor?: string,
  options: { force?: boolean } = {},
): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withTaskLock(projectRoot, taskId, actor, async (tx) => {
    if (tx.status !== "doing") {
      throw new AxaError(
        "INVALID_STATE",
        `Task ${tx.task.id} is ${tx.status}; only doing tasks can be completed.`,
      );
    }
    if (!hasAgentSummary(tx.task)) {
      throw new AxaError(
        "INVALID_TASK",
        `Task ${tx.task.id} has no agent summary for this round. Run "axa summary ${tx.task.id} --file <path>" first.`,
      );
    }
    if (!options.force && actor && tx.task.claimedBy && tx.task.claimedBy !== actor) {
      throw new AxaError(
        "FORBIDDEN",
        `Task ${tx.task.id} is claimed by ${tx.task.claimedBy}; ${actor} cannot complete it.`,
      );
    }
    const completedBy = actor ?? tx.task.claimedBy ?? "unknown";
    const nextStatus: TaskStatus = tx.task.reviewRequired ? "review" : "done";
    return tx.move(nextStatus, (next) => {
      next.extra = {
        ...next.extra,
        completed_at: new Date().toISOString(),
        completed_by: completedBy,
      };
      delete next.claimedBy;
      delete next.claimedAt;
    });
  });
}

export async function acceptTask(
  projectRoot: string,
  taskId: string,
  actor?: string,
): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withTaskLock(projectRoot, taskId, actor, async (tx) => {
    if (tx.status !== "review") {
      throw new AxaError(
        "INVALID_STATE",
        `Task ${tx.task.id} is ${tx.status}; only review tasks can be accepted.`,
      );
    }
    return tx.move("done", (next) => {
      next.extra = {
        ...next.extra,
        accepted_at: new Date().toISOString(),
        accepted_by: actor ?? "human",
      };
    });
  });
}

export async function releaseStaleTasks(
  projectRoot: string,
  olderThanMs: number = STALE_CLAIM_MS,
): Promise<ReleaseStaleResult> {
  await assertAxaProject(projectRoot);
  if (!Number.isFinite(olderThanMs) || olderThanMs <= 0) {
    throw new AxaError("INVALID_TASK", "olderThanMs must be a positive number.");
  }

  const { tasks } = await scanTasks(projectRoot, { statuses: ["doing"] });
  const now = Date.now();
  const released: Task[] = [];
  let skipped = 0;

  for (const task of tasks) {
    const claimedAt = task.claimedAt ? new Date(task.claimedAt).getTime() : Number.NaN;
    if (!Number.isFinite(claimedAt) || now - claimedAt < olderThanMs) {
      skipped += 1;
      continue;
    }
    try {
      released.push(await releaseTask(projectRoot, task.id, { force: true }));
    } catch {
      skipped += 1;
    }
  }

  return { released, skipped };
}

function extraTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export async function maintainProject(
  projectRoot: string,
  options: { now?: Date; releaseAfterMs?: number; archiveAfterMs?: number } = {},
): Promise<MaintenanceResult> {
  await assertAxaProject(projectRoot);
  const now = options.now?.getTime() ?? Date.now();
  const releaseAfterMs = options.releaseAfterMs ?? STALE_CLAIM_MS;
  const archiveAfterMs = options.archiveAfterMs ?? ARCHIVE_AFTER_MS;

  const releaseResult = await releaseStaleTasks(projectRoot, releaseAfterMs);

  const { tasks } = await scanTasks(projectRoot, { statuses: ["done"] });
  const archived: Task[] = [];
  for (const task of tasks) {
    const finishedAt =
      extraTimestamp(task.extra.accepted_at) ??
      extraTimestamp(task.extra.completed_at) ??
      new Date(task.updatedAt).getTime();
    if (!Number.isFinite(finishedAt) || now - finishedAt < archiveAfterMs) continue;
    try {
      archived.push(
        await withTaskLock(projectRoot, task.id, "axa", async (tx) => {
          if (tx.status !== "done") {
            throw new AxaError("INVALID_STATE", `Task ${tx.task.id} is ${tx.status}, not done.`);
          }
          return tx.move("archived", (next) => {
            next.extra = {
              ...next.extra,
              archived_at: new Date(now).toISOString(),
              archived_by: "auto",
            };
          });
        }),
      );
    } catch {
      // The task moved while maintenance was running.
    }
  }

  return { released: releaseResult.released, archived };
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
  return withTaskLock(projectRoot, taskId, undefined, async (tx) => {
    const { conversation } = await updateLatestUserMessage(tx.task, body);
    return tx.save((next) => {
      next.body = body;
      next.conversation = conversation;
    });
  });
}

export { buildTaskFilename, buildTaskFolderName, slugifyTitle };
