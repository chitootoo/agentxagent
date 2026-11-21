export const TASK_STATUSES = ["backlog", "todo", "doing", "review", "done", "archived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ACTIVE_TASK_STATUSES = ["backlog", "todo", "doing", "review", "done"] as const;
export type ActiveTaskStatus = (typeof ACTIVE_TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["P0", "P1", "P2"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const CONVERSATION_ROLES = ["user", "agent"] as const;
export type ConversationRole = (typeof CONVERSATION_ROLES)[number];

export interface ConversationEntry {
  seq: string;
  role: ConversationRole;
  title: string;
  filename: string;
  filePath: string;
  body: string;
  /** Agent that produced this message, recorded in the message frontmatter. */
  agent?: string;
}

export interface Task {
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  /** Latest user message, kept as the current task brief for clients. */
  body: string;
  /** Task directory name, or a legacy `.md` filename before migration. */
  filename: string;
  /** Task directory, or a legacy `.md` file before migration. */
  filePath: string;
  metadataPath: string;
  projectRoot: string;
  reviewRequired: boolean;
  claimedBy?: string;
  claimedAt?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  extra: Record<string, unknown>;
  conversation: ConversationEntry[];
  /** True for tasks that still use the pre-018 single Markdown file layout. */
  legacy: boolean;
}

export interface ProjectInfo {
  name: string;
  path: string;
  axaPath: string;
  skillPath: string;
  tasksReadmePath: string;
  counts: Record<TaskStatus, number>;
  total: number;
}

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

export interface AxaConfig {
  version: 1;
  projects: ProjectConfig[];
  defaultProjectId?: string;
}

export interface ListProjectsResult extends ProjectInfo {
  id: string;
  exists: boolean;
}

export interface CreateTaskInput {
  projectRoot: string;
  title: string;
  body?: string;
  priority?: TaskPriority;
  status?: Extract<TaskStatus, "backlog" | "todo">;
  /** Defaults to true: finished work waits for human acceptance. */
  reviewRequired?: boolean;
  tags?: string[];
  extra?: Record<string, unknown>;
  actor?: string;
}

export interface AppendTaskMessageInput {
  projectRoot: string;
  taskId: string;
  role: ConversationRole;
  message: string;
  title?: string;
  actor?: string;
}

export interface UpdateTaskInput {
  projectRoot: string;
  taskId: string;
  title: string;
  body: string;
  priority?: TaskPriority;
  reviewRequired?: boolean;
  tags?: string[];
  extra?: Record<string, unknown>;
}

export interface ListTasksOptions {
  statuses?: TaskStatus[];
  priority?: TaskPriority;
  claimedBy?: string;
  /** Archived tasks are excluded unless a status filter asks for them. */
  includeArchived?: boolean;
}

export interface ClaimTaskInput {
  projectRoot: string;
  taskId?: string;
  /** Agent platform name, e.g. qoder, trae, codex. The CLI mints the round id. */
  agentPlatform: string;
  next?: boolean;
}

export interface InitProjectOptions {
  projectRoot: string;
  name?: string;
  instruction?: string;
}

export interface ReleaseStaleResult {
  released: Task[];
  skipped: number;
}

export interface ReleaseTaskOptions {
  actor?: string;
  /** Humans may release any claimed task; agents may only release their own. */
  force?: boolean;
}

export interface MaintenanceResult {
  released: Task[];
  archived: Task[];
}

export interface TaskIssue {
  filePath: string;
  message: string;
}
