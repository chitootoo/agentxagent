import { create } from "@bufbuild/protobuf";
import type { ServiceImpl } from "@connectrpc/connect";
import {
  AxaError,
  approveTask,
  type Task as CoreTask,
  type TaskPriority as CoreTaskPriority,
  type TaskStatus as CoreTaskStatus,
  claimTask,
  completeTask,
  createTask,
  getTask,
  type ListProjectsResult,
  listRegisteredProjects,
  reclaimStaleTasks,
  registerProject,
  releaseTask,
  removeRegisteredProject,
  scanTasks,
} from "@contagxt/axa-core";
import {
  type Activity,
  ActivitySchema,
  ApproveTaskResponseSchema,
  ClaimTaskResponseSchema,
  CompleteTaskResponseSchema,
  type CreateTaskRequest,
  type CreateTaskResponse,
  CreateTaskResponseSchema,
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
  type ReclaimStaleTasksRequest,
  type ReclaimStaleTasksResponse,
  ReclaimStaleTasksResponseSchema,
  type RegisterProjectRequest,
  type RegisterProjectResponse,
  RegisterProjectResponseSchema,
  ReleaseTaskResponseSchema,
  type RemoveProjectResponse,
  RemoveProjectResponseSchema,
  type Task,
  TaskPriority,
  TaskSchema,
  type TaskService,
  TaskStatus,
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
  done: TaskStatus.DONE,
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
    case TaskStatus.DONE:
      return "done";
    default:
      return undefined;
  }
}

function extraString(task: CoreTask, key: string): string {
  const value = task.extra[key];
  return typeof value === "string" ? value : "";
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
    doneCount: project.counts.done,
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
  });
}

function logTask(
  projectId: string,
  task: CoreTask,
  action: string,
  actor: string | undefined,
): void {
  recordActivity({
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
      ...(req.name.trim() ? { name: req.name.trim() } : {}),
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
      tags: req.tags,
      ...(req.actor.trim() ? { actor: req.actor.trim() } : {}),
    });
    logTask(project.id, task, "create", req.actor);
    return create(CreateTaskResponseSchema, { task: toTask(task) });
  },

  async approveTask(req) {
    const project = await requireProject(req.projectId);
    const task = await approveTask(project.path, req.taskId, req.actor);
    logTask(project.id, task, "approve", req.actor);
    return create(ApproveTaskResponseSchema, { task: toTask(task) });
  },

  async claimTask(req) {
    const project = await requireProject(req.projectId);
    const task = await claimTask({
      projectRoot: project.path,
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.next ? { next: true } : {}),
      agent: req.actor.trim() || "console",
    });
    logTask(project.id, task, "claim", req.actor);
    return create(ClaimTaskResponseSchema, { task: toTask(task) });
  },

  async releaseTask(req) {
    const project = await requireProject(req.projectId);
    const task = await releaseTask(project.path, req.taskId);
    logTask(project.id, task, "release", req.actor);
    return create(ReleaseTaskResponseSchema, { task: toTask(task) });
  },

  async completeTask(req) {
    const project = await requireProject(req.projectId);
    const task = await completeTask(project.path, req.taskId, req.actor);
    logTask(project.id, task, "complete", req.actor);
    return create(CompleteTaskResponseSchema, { task: toTask(task) });
  },

  async reclaimStaleTasks(req: ReclaimStaleTasksRequest): Promise<ReclaimStaleTasksResponse> {
    const project = await requireProject(req.projectId);
    const seconds = req.olderThanSeconds > 0 ? req.olderThanSeconds : 86_400;
    const result = await reclaimStaleTasks(project.path, seconds * 1000);
    for (const task of result.reclaimed) {
      logTask(project.id, task, "reclaim", req.actor);
    }
    return create(ReclaimStaleTasksResponseSchema, {
      reclaimed: result.reclaimed.map(toTask),
      skipped: result.skipped,
    });
  },

  async listActivity(req: ListActivityRequest): Promise<ListActivityResponse> {
    const projectId = req.projectId.trim();
    if (projectId) {
      await requireProject(projectId);
    }
    const limit = Math.min(Math.max(req.limit || 30, 1), 200);
    const rows = listActivityRows(projectId || undefined, limit);
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
