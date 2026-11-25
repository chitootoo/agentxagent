import { create } from "@bufbuild/protobuf";
import type { ServiceImpl } from "@connectrpc/connect";
import {
  AxaError,
  acceptTask,
  appendTaskMessage,
  approveTask,
  type ConversationRole as CoreConversationRole,
  type Task as CoreTask,
  type TaskPriority as CoreTaskPriority,
  type TaskStatus as CoreTaskStatus,
  claimTask,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  type ListProjectsResult,
  listRegisteredProjects,
  maintainProject,
  parseFrontmatterData,
  registerProject,
  releaseStaleTasks,
  releaseTask,
  removeRegisteredProject,
  STALE_CLAIM_MS,
  scanTasks,
  stringifyFrontmatterData,
  updateTask,
} from "@contagxt/axa-core";
import {
  AcceptTaskResponseSchema,
  type Activity,
  ActivitySchema,
  AppendTaskMessageResponseSchema,
  ApproveTaskResponseSchema,
  ClaimTaskResponseSchema,
  CompleteTaskResponseSchema,
  ConversationEntrySchema,
  ConversationRole,
  type CreateTaskRequest,
  type CreateTaskResponse,
  CreateTaskResponseSchema,
  type DeleteTaskRequest,
  type DeleteTaskResponse,
  DeleteTaskResponseSchema,
  type GetTaskRequest,
  type GetTaskResponse,
  GetTaskResponseSchema,
  type ListActivityRequest,
  type ListActivityResponse,
  ListActivityResponseSchema,
  type ListProjectsResponse,
  ListProjectsResponseSchema,
  type ListTasksRequest,
  type ListTasksResponse,
  ListTasksResponseSchema,
  type Project,
  ProjectSchema,
  type RegisterProjectRequest,
  type RegisterProjectResponse,
  RegisterProjectResponseSchema,
  type ReleaseStaleTasksRequest,
  type ReleaseStaleTasksResponse,
  ReleaseStaleTasksResponseSchema,
  ReleaseTaskResponseSchema,
  type RemoveProjectResponse,
  RemoveProjectResponseSchema,
  type Task,
  TaskPriority,
  TaskSchema,
  type TaskService,
  TaskStatus,
  type UpdateTaskRequest,
  type UpdateTaskResponse,
  UpdateTaskResponseSchema,
} from "@contagxt/axa-proto";
import { requireProjectSummary } from "../config/projects";
import { listActivityRows, recordActivity } from "./db/index";

const PRIORITY_TO_PROTO: Record<CoreTaskPriority, TaskPriority> = {
  P0: TaskPriority.P0,
  P1: TaskPriority.P1,
  P2: TaskPriority.P2,
};

const STATUS_TO_PROTO: Record<CoreTaskStatus, TaskStatus> = {
  backlog: TaskStatus.BACKLOG,
  todo: TaskStatus.TODO,
  doing: TaskStatus.DOING,
  review: TaskStatus.REVIEW,
  done: TaskStatus.DONE,
  archived: TaskStatus.ARCHIVED,
};

function priorityFromProto(priority: TaskPriority): CoreTaskPriority {
  switch (priority) {
    case TaskPriority.P0:
      return "P0";
    case TaskPriority.P1:
      return "P1";
    case TaskPriority.P2:
      return "P2";
    default:
      return "P1";
  }
}

function statusFromProto(status: TaskStatus): CoreTaskStatus | undefined {
  switch (status) {
    case TaskStatus.BACKLOG:
      return "backlog";
    case TaskStatus.TODO:
      return "todo";
    case TaskStatus.DOING:
      return "doing";
    case TaskStatus.REVIEW:
      return "review";
    case TaskStatus.DONE:
      return "done";
    case TaskStatus.ARCHIVED:
      return "archived";
    default:
      return undefined;
  }
}

const ROLE_TO_PROTO: Record<CoreConversationRole, ConversationRole> = {
  user: ConversationRole.USER,
  agent: ConversationRole.AGENT,
};

function roleFromProto(role: ConversationRole): CoreConversationRole | undefined {
  switch (role) {
    case ConversationRole.USER:
      return "user";
    case ConversationRole.AGENT:
      return "agent";
    default:
      return undefined;
  }
}

function extraString(task: CoreTask, key: string): string {
  const value = task.extra[key];
  return typeof value === "string" ? value : "";
}

function extraFromFrontmatter(source: string): Record<string, unknown> {
  const trimmed = source.trim();
  return trimmed ? parseFrontmatterData(trimmed) : {};
}

function toProject(project: ListProjectsResult): Project {
  return create(ProjectSchema, {
    id: project.id,
    name: project.name,
    path: project.path,
    axaPath: project.axaPath,
    exists: project.exists,
    backlogCount: project.counts.backlog,
    todoCount: project.counts.todo,
    doingCount: project.counts.doing,
    reviewCount: project.counts.review,
    doneCount: project.counts.done,
    archivedCount: project.counts.archived,
    totalTasks: project.total,
  });
}

function toTask(task: CoreTask): Task {
  return create(TaskSchema, {
    id: task.id,
    title: task.title,
    priority: PRIORITY_TO_PROTO[task.priority],
    status: STATUS_TO_PROTO[task.status],
    body: task.body,
    filename: task.filename,
    filePath: task.filePath,
    claimedBy: task.claimedBy ?? "",
    claimedAt: task.claimedAt ?? "",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    tags: task.tags,
    createdBy: extraString(task, "created_by"),
    completedBy: extraString(task, "completed_by"),
    completedAt: extraString(task, "completed_at"),
    frontmatter: stringifyFrontmatterData(task.extra),
    reviewRequired: task.reviewRequired,
    conversation: task.conversation.map((entry) =>
      create(ConversationEntrySchema, {
        seq: entry.seq,
        role: ROLE_TO_PROTO[entry.role],
        title: entry.title,
        filename: entry.filename,
        filePath: entry.filePath,
        body: entry.body,
        agent: entry.agent ?? "",
      }),
    ),
  });
}

async function logTask(
  projectId: string,
  task: CoreTask,
  action: string,
  actor: string | undefined,
): Promise<void> {
  await recordActivity({
    projectId,
    taskId: task.id,
    taskTitle: task.title,
    action,
    actor: actor?.trim() || "console",
  });
}

async function requireProject(projectId: string) {
  return requireProjectSummary(projectId);
}

export const taskServiceImpl: ServiceImpl<typeof TaskService> = {
  async listProjects(): Promise<ListProjectsResponse> {
    const projects = await listRegisteredProjects();
    return create(ListProjectsResponseSchema, { projects: projects.map(toProject) });
  },

  async registerProject(req: RegisterProjectRequest): Promise<RegisterProjectResponse> {
    const project = await registerProject({
      path: req.path,
      ...(req.initialize ? { initialize: true } : {}),
    });
    const summary = await requireProjectSummary(project.id);
    return create(RegisterProjectResponseSchema, { project: toProject(summary) });
  },

  async removeProject(req): Promise<RemoveProjectResponse> {
    await removeRegisteredProject(req.projectId);
    return create(RemoveProjectResponseSchema, {});
  },

  async listTasks(req: ListTasksRequest): Promise<ListTasksResponse> {
    const project = await requireProject(req.projectId);
    const maintenance = await maintainProject(project.path);
    for (const task of maintenance.released) {
      await logTask(project.id, task, "release_stale", "axa");
    }
    for (const task of maintenance.archived) {
      await logTask(project.id, task, "archive", "axa");
    }
    const statuses = req.statuses
      .map(statusFromProto)
      .filter((status): status is CoreTaskStatus => status !== undefined);
    const priority =
      req.priority === TaskPriority.UNSPECIFIED ? undefined : priorityFromProto(req.priority);
    const { tasks } = await scanTasks(project.path, {
      ...(statuses.length > 0 ? { statuses } : {}),
      ...(priority ? { priority } : {}),
      ...(req.claimedBy.trim() ? { claimedBy: req.claimedBy.trim() } : {}),
    });
    return create(ListTasksResponseSchema, {
      project: toProject(project),
      tasks: tasks.map(toTask),
    });
  },

  async getTask(req: GetTaskRequest): Promise<GetTaskResponse> {
    const project = await requireProject(req.projectId);
    return create(GetTaskResponseSchema, {
      task: toTask(await getTask(project.path, req.taskId)),
    });
  },

  async createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {
    const project = await requireProject(req.projectId);
    const status = statusFromProto(req.status) ?? "backlog";
    if (status !== "backlog" && status !== "todo") {
      throw new AxaError("INVALID_TASK", "New tasks can only be created in backlog or todo.");
    }
    const task = await createTask({
      projectRoot: project.path,
      title: req.title,
      body: req.body,
      priority: priorityFromProto(req.priority),
      status,
      ...(req.reviewRequired !== undefined ? { reviewRequired: req.reviewRequired } : {}),
      tags: req.tags,
      extra: extraFromFrontmatter(req.frontmatter),
      ...(req.actor.trim() ? { actor: req.actor.trim() } : {}),
    });
    await logTask(project.id, task, "create", req.actor);
    return create(CreateTaskResponseSchema, { task: toTask(task) });
  },

  async updateTask(req: UpdateTaskRequest): Promise<UpdateTaskResponse> {
    const project = await requireProject(req.projectId);
    const task = await updateTask({
      projectRoot: project.path,
      taskId: req.taskId,
      title: req.title,
      body: req.body,
      ...(req.priority !== TaskPriority.UNSPECIFIED
        ? { priority: priorityFromProto(req.priority) }
        : {}),
      ...(req.reviewRequired !== undefined ? { reviewRequired: req.reviewRequired } : {}),
      tags: req.tags,
      extra: extraFromFrontmatter(req.frontmatter),
    });
    await logTask(project.id, task, "update", req.actor);
    return create(UpdateTaskResponseSchema, { task: toTask(task) });
  },

  async deleteTask(req: DeleteTaskRequest): Promise<DeleteTaskResponse> {
    const project = await requireProject(req.projectId);
    const task = await deleteTask(project.path, req.taskId);
    await logTask(project.id, task, "delete", req.actor);
    return create(DeleteTaskResponseSchema, { task: toTask(task) });
  },

  async approveTask(req) {
    const project = await requireProject(req.projectId);
    const task = await approveTask(project.path, req.taskId, req.actor);
    await logTask(project.id, task, "approve", req.actor);
    return create(ApproveTaskResponseSchema, { task: toTask(task) });
  },

  async claimTask(req) {
    const project = await requireProject(req.projectId);
    const task = await claimTask({
      projectRoot: project.path,
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.next ? { next: true } : {}),
      agentPlatform: req.actor.trim() || "console",
    });
    await logTask(project.id, task, "claim", req.actor);
    return create(ClaimTaskResponseSchema, { task: toTask(task) });
  },

  async releaseTask(req) {
    const project = await requireProject(req.projectId);
    const task = await releaseTask(project.path, req.taskId, {
      ...(req.actor.trim() ? { actor: req.actor.trim() } : {}),
      force: true,
    });
    await logTask(project.id, task, "release", req.actor);
    return create(ReleaseTaskResponseSchema, { task: toTask(task) });
  },

  async completeTask(req) {
    const project = await requireProject(req.projectId);
    const task = await completeTask(project.path, req.taskId, req.actor, { force: true });
    await logTask(project.id, task, "complete", req.actor);
    return create(CompleteTaskResponseSchema, { task: toTask(task) });
  },

  async acceptTask(req) {
    const project = await requireProject(req.projectId);
    const task = await acceptTask(project.path, req.taskId, req.actor);
    await logTask(project.id, task, "accept", req.actor);
    return create(AcceptTaskResponseSchema, { task: toTask(task) });
  },

  async appendTaskMessage(req) {
    const project = await requireProject(req.projectId);
    const role = roleFromProto(req.role);
    if (!role) {
      throw new AxaError("INVALID_TASK", "Message role must be user or agent.");
    }
    const task = await appendTaskMessage({
      projectRoot: project.path,
      taskId: req.taskId,
      role,
      message: req.message,
      ...(req.title.trim() ? { title: req.title.trim() } : {}),
      ...(req.actor.trim() ? { actor: req.actor.trim() } : {}),
    });
    await logTask(project.id, task, role === "user" ? "comment" : "summary", req.actor);
    return create(AppendTaskMessageResponseSchema, { task: toTask(task) });
  },

  async releaseStaleTasks(req: ReleaseStaleTasksRequest): Promise<ReleaseStaleTasksResponse> {
    const project = await requireProject(req.projectId);
    const seconds = req.olderThanSeconds > 0 ? req.olderThanSeconds : STALE_CLAIM_MS / 1000;
    const result = await releaseStaleTasks(project.path, seconds * 1000);
    for (const task of result.released) {
      await logTask(project.id, task, "release_stale", req.actor);
    }
    return create(ReleaseStaleTasksResponseSchema, {
      released: result.released.map(toTask),
      skipped: result.skipped,
    });
  },

  async listActivity(req: ListActivityRequest): Promise<ListActivityResponse> {
    const projectId = req.projectId.trim();
    if (projectId) {
      await requireProject(projectId);
    }
    const limit = Math.min(Math.max(req.limit || 30, 1), 200);
    const rows = await listActivityRows(projectId || undefined, limit);
    const activities: Activity[] = rows.map((row) =>
      create(ActivitySchema, {
        id: row.id,
        projectId: row.projectId,
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        action: row.action,
        actor: row.actor,
        createdAt: row.createdAt.toISOString(),
      }),
    );
    return create(ListActivityResponseSchema, { activities });
  },
};
