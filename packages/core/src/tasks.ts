import type { Dirent } from "node:fs";
import { readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
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
  AppendTaskMessageInput,
  ClaimTaskInput,
  ConversationEntry,
  CreateTaskInput,
  InitProjectOptions,
  ListTasksOptions,
  ProjectInfo,
  ReclaimStaleResult,
  Task,
  TaskIssue,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from "./types.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "./types.js";

export const TASK_METADATA_FILE = "task.json";

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

function defaultConversationTitle(body: string, fallback: string): string {
  const firstLine = body
    .split(/\r?\n/u)
    .map((line) => line.replace(/^[#>*_\-\s]+/u, "").trim())
    .find(Boolean);
  return firstLine ? slugifyTitle(firstLine) : slugifyTitle(fallback);
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
    const body = (await readFile(filePath, "utf8")).trim();
    conversation.push({
      seq: parsed.seq,
      role: parsed.role,
      title: parsed.title,
      filename: entry.name,
      filePath,
      body,
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

async function persistAndMove(
  task: Task,
  nextStatus: TaskStatus,
  projectRoot: string,
  mutate?: (next: Task) => void,
): Promise<Task> {
  const current = await migrateLegacyTask(task);
  const nextTask: Task = { ...current, status: nextStatus, updatedAt: new Date().toISOString() };
  mutate?.(nextTask);

  const destination = join(statusDir(projectRoot, nextStatus), nextTask.filename);
  if (destination !== current.filePath && (await pathExists(destination))) {
    throw new AxaError("CONFLICT", `A task directory already exists at ${destination}.`);
  }

  await writeFileAtomic(nextTask.metadataPath, serializeMetadata(nextTask));
  if (destination !== current.filePath) {
    await ensureTaskDirs(projectRoot);
    await rename(current.filePath, destination);
  }
  return readTaskFolder(destination, projectRoot, nextStatus);
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

  return withLock(projectLockPath(projectRoot), async () => {
    const location = await findTaskLocation(projectRoot, input.taskId);
    const task = await migrateLegacyTask(location.task);
    const { status } = location;
    const next: Task = {
      ...task,
      title,
      body: input.body.trim(),
      priority: input.priority ?? task.priority,
      reviewRequired: input.reviewRequired ?? task.reviewRequired,
      tags: input.tags ? input.tags.map((tag) => tag.trim()).filter(Boolean) : task.tags,
      extra: input.extra ? sanitizeExtra(input.extra) : task.extra,
      updatedAt: new Date().toISOString(),
    };

    const filename = buildTaskFolderName(next.id, next.priority, title);
    next.filename = filename;

    const destination = join(statusDir(projectRoot, status), filename);
    if (destination !== task.filePath && (await pathExists(destination))) {
      throw new AxaError("CONFLICT", `A task directory already exists at ${destination}.`);
    }

    await updateLatestUserMessage(next, next.body);
    if (destination !== task.filePath) {
      await rename(task.filePath, destination);
    }
    next.metadataPath = join(destination, TASK_METADATA_FILE);
    await writeFileAtomic(next.metadataPath, serializeMetadata(next));
    return readTaskFolder(destination, projectRoot, status);
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

  return withLock(projectLockPath(projectRoot), async () => {
    const location = await findTaskLocation(projectRoot, input.taskId);
    const task = await migrateLegacyTask(location.task);
    const seq = nextConversationSeq(task.conversation);
    const title = input.title?.trim() || defaultConversationTitle(message, task.title);
    const filename = buildMessageFilename(seq, input.role, title);
    const filePath = join(task.filePath, filename);
    await writeFileAtomic(filePath, `${message}\n`);

    const next: Task = {
      ...task,
      updatedAt: new Date().toISOString(),
      extra: {
        ...task.extra,
        ...(input.actor ? { updated_by: input.actor } : {}),
      },
    };

    const conversation: ConversationEntry[] = [
      ...task.conversation,
      {
        seq,
        role: input.role,
        title: humanizeDescription(slugifyTitle(title)),
        filename,
        filePath,
        body: message,
      },
    ];

    let nextStatus = task.status;
    if (input.role === "user" && (task.status === "review" || task.status === "done")) {
      nextStatus = "todo";
      delete next.claimedBy;
      delete next.claimedAt;
      const extra = { ...next.extra };
      for (const key of ["completed_at", "completed_by", "accepted_at", "accepted_by"]) {
        delete extra[key];
      }
      next.extra = extra;
    }

    const reopened: Task = { ...next, conversation, status: nextStatus };
    await writeFileAtomic(reopened.metadataPath, serializeMetadata(reopened));

    const destination = join(statusDir(projectRoot, nextStatus), reopened.filename);
    if (destination !== reopened.filePath) {
      if (await pathExists(destination)) {
        throw new AxaError("CONFLICT", `A task directory already exists at ${destination}.`);
      }
      await ensureTaskDirs(projectRoot);
      await rename(reopened.filePath, destination);
    }
    return readTaskFolder(destination, projectRoot, nextStatus);
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
  return withLock(projectLockPath(projectRoot), async () => {
    const { task } = await findTaskLocation(projectRoot, taskId);
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

function hasAgentSummary(task: Task): boolean {
  return task.conversation.at(-1)?.role === "agent";
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
    if (task.reviewRequired && !hasAgentSummary(task)) {
      throw new AxaError(
        "INVALID_TASK",
        `Task ${task.id} needs an agent summary before review. Run "axa summary ${task.id} -m ..." first.`,
      );
    }
    const nextStatus: TaskStatus = task.reviewRequired ? "review" : "done";
    return persistAndMove(task, nextStatus, projectRoot, (next) => {
      next.extra = {
        ...next.extra,
        completed_at: new Date().toISOString(),
        completed_by: actor ?? next.claimedBy ?? "unknown",
      };
    });
  });
}

export async function acceptTask(
  projectRoot: string,
  taskId: string,
  actor?: string,
): Promise<Task> {
  await assertAxaProject(projectRoot);
  return withLock(projectLockPath(projectRoot), async () => {
    const { task, status } = await findTaskLocation(projectRoot, taskId);
    if (status !== "review") {
      throw new AxaError(
        "INVALID_STATE",
        `Task ${task.id} is ${status}; only review tasks can be accepted.`,
      );
    }
    return persistAndMove(task, "done", projectRoot, (next) => {
      next.extra = {
        ...next.extra,
        accepted_at: new Date().toISOString(),
        accepted_by: actor ?? "human",
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
    const { task, status } = await findTaskLocation(projectRoot, taskId);
    const migrated = await migrateLegacyTask(task);
    const next: Task = { ...migrated, body, updatedAt: new Date().toISOString() };
    const { conversation } = await updateLatestUserMessage(next, body);
    next.conversation = conversation;
    await writeFileAtomic(next.metadataPath, serializeMetadata(next));
    return readTaskFolder(next.filePath, projectRoot, status);
  });
}

export { buildTaskFilename, buildTaskFolderName, slugifyTitle };
