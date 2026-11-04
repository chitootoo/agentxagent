export const TASK_STATUSES = ["backlog", "todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["P0", "P1", "P2"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task {
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  body: string;
  filename: string;
  filePath: string;
  projectRoot: string;
  claimedBy?: string;
  claimedAt?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  extra: Record<string, unknown>;
}

export interface ProjectInfo {
  name: string;
  path: string;
  axaPath: string;
  instructionPath: string;
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
  tags?: string[];
  actor?: string;
}

export interface ListTasksOptions {
  statuses?: TaskStatus[];
  priority?: TaskPriority;
  claimedBy?: string;
}

export interface ClaimTaskInput {
  projectRoot: string;
  taskId?: string;
  agent: string;
  next?: boolean;
}

export interface InitProjectOptions {
  projectRoot: string;
  name?: string;
  instruction?: string;
}

export interface ReclaimStaleResult {
  reclaimed: Task[];
  skipped: number;
}

export interface TaskIssue {
  filePath: string;
  message: string;
}
