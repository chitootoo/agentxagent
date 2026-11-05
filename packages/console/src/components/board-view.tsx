"use client";

import {
  type Activity,
  ConversationRole,
  type Project,
  type Task,
  TaskStatus,
} from "@contagxt/axa-proto";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { taskClient } from "@/lib/client";
import { errorMessage, formatRelativeTime, shortPath } from "@/lib/format";
import { copyText, taskExecutionPrompt } from "@/lib/instruction";
import { actionLabel, statusMeta } from "@/lib/task-meta";
import { ArrowLeftIcon, CheckIcon, RefreshIcon, SparkIcon, TrashIcon } from "./icons";
import { NewTaskCard, type NewTaskDraft } from "./new-task-card";
import { TaskCard, type TaskDraft } from "./task-card";

const COLUMNS = [
  TaskStatus.BACKLOG,
  TaskStatus.TODO,
  TaskStatus.DOING,
  TaskStatus.REVIEW,
  TaskStatus.DONE,
] as const;

interface BoardViewProps {
  projectId: string;
}

export function BoardView({ projectId }: BoardViewProps) {
  const [project, setProject] = useState<Project>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [actor, setActor] = useState("human");

  useEffect(() => {
    const saved = window.localStorage.getItem("axa.actor");
    if (saved) setActor(saved);
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [taskResponse, activityResponse] = await Promise.all([
          taskClient.listTasks({ projectId }),
          taskClient.listActivity({ projectId, limit: 12 }),
        ]);
        setProject(taskResponse.project);
        setTasks(taskResponse.tasks);
        setActivities(activityResponse.activities);
        setError(undefined);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function updateActor(value: string) {
    setActor(value);
    window.localStorage.setItem("axa.actor", value);
  }

  async function runAction(
    taskId: string,
    action: () => Promise<unknown>,
    message: string,
  ): Promise<boolean> {
    setBusyId(taskId);
    setActionError(undefined);
    setNotice(undefined);
    try {
      await action();
      setNotice(message);
      await load(true);
      return true;
    } catch (cause) {
      setActionError(errorMessage(cause));
      return false;
    } finally {
      setBusyId(undefined);
    }
  }

  async function saveTask(task: Task, draft: TaskDraft): Promise<boolean> {
    const title = draft.title.trim();
    if (!title) {
      setActionError("任务标题不能为空。");
      return false;
    }
    return runAction(
      task.id,
      () =>
        taskClient.updateTask({
          projectId,
          taskId: task.id,
          title,
          body: draft.body,
          priority: draft.priority,
          reviewRequired: draft.reviewRequired,
          tags: draft.tags,
          frontmatter: draft.frontmatter,
          actor,
        }),
      `已保存 #${task.id}`,
    );
  }

  async function createNewTask(draft: NewTaskDraft): Promise<boolean> {
    const title = draft.title.trim();
    if (!title) {
      setActionError("任务标题不能为空。");
      return false;
    }
    setBusyId("__create");
    setActionError(undefined);
    setNotice(undefined);
    try {
      const response = await taskClient.createTask({
        projectId,
        title,
        body: draft.body,
        priority: draft.priority,
        status: draft.status,
        reviewRequired: draft.reviewRequired,
        tags: draft.tags,
        frontmatter: draft.frontmatter,
        actor,
      });
      setNotice(response.task ? `已创建 #${response.task.id}` : "已创建任务");
      await load(true);
      return true;
    } catch (cause) {
      setActionError(errorMessage(cause));
      return false;
    } finally {
      setBusyId(undefined);
    }
  }

  async function deleteTask(task: Task): Promise<boolean> {
    return runAction(
      task.id,
      () => taskClient.deleteTask({ projectId, taskId: task.id, actor }),
      `已删除 #${task.id}`,
    );
  }

  async function approveTask(task: Task) {
    await runAction(
      task.id,
      () => taskClient.approveTask({ projectId, taskId: task.id, actor }),
      `已批准 #${task.id}`,
    );
  }

  async function copyInstruction(task: Task) {
    if (!project?.path) {
      setActionError("项目路径尚未加载，请稍后重试。");
      return;
    }
    setActionError(undefined);
    setNotice(undefined);
    try {
      await copyText(taskExecutionPrompt(task, project.path));
      setNotice(`已复制 #${task.id} 的执行指令，粘贴给 Agent 即可开始。`);
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  }

  async function commentTask(task: Task, message: string): Promise<boolean> {
    return runAction(
      task.id,
      () =>
        taskClient.appendTaskMessage({
          projectId,
          taskId: task.id,
          role: ConversationRole.USER,
          message,
          actor,
        }),
      `已追加需求 #${task.id}，任务已回到 Todo`,
    );
  }

  async function releaseTask(task: Task) {
    await runAction(
      task.id,
      () => taskClient.releaseTask({ projectId, taskId: task.id, actor }),
      `已释放 #${task.id}`,
    );
  }

  async function completeTask(task: Task) {
    await runAction(
      task.id,
      () => taskClient.completeTask({ projectId, taskId: task.id, actor }),
      task.reviewRequired ? `已提交验收 #${task.id}` : `已完成 #${task.id}`,
    );
  }

  async function acceptTask(task: Task) {
    await runAction(
      task.id,
      () => taskClient.acceptTask({ projectId, taskId: task.id, actor }),
      `已验收通过 #${task.id}`,
    );
  }

  async function reclaimStale() {
    setBusyId("__reclaim");
    setActionError(undefined);
    setNotice(undefined);
    try {
      const response = await taskClient.reclaimStaleTasks({
        projectId,
        olderThanSeconds: 86_400,
        actor,
      });
      setNotice(
        response.reclaimed.length > 0
          ? `已回收 ${response.reclaimed.length} 个超过 24 小时未完成的任务`
          : "没有需要回收的任务",
      );
      await load(true);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusyId(undefined);
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <div className="skeleton skeleton-title" />
        <div className="board-grid">
          {COLUMNS.map((status) => (
            <div className="skeleton skeleton-column" key={status} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="panel empty-state">
        <h1>无法打开项目</h1>
        <p>{error}</p>
        <Link className="button secondary" href="/">
          返回项目列表
        </Link>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="breadcrumb">
        <Link href="/">
          <ArrowLeftIcon size={15} /> 项目
        </Link>
        <span>/</span>
        <span>{project?.name ?? projectId}</span>
      </div>

      <header className="board-header">
        <div>
          <span className="eyebrow">Task board</span>
          <h1>{project?.name ?? projectId}</h1>
          <code className="path" title={project?.path}>
            {project ? shortPath(project.path) : projectId}
          </code>
        </div>
        <div className="board-actions">
          <label className="operator-field">
            <span>操作人</span>
            <input
              aria-label="操作人"
              maxLength={60}
              onChange={(event) => updateActor(event.target.value)}
              placeholder="human"
              value={actor}
            />
          </label>
          <button
            className="button ghost"
            disabled={busyId === "__reclaim"}
            onClick={() => void reclaimStale()}
            type="button"
          >
            <RefreshIcon size={15} /> 回收超时
          </button>
        </div>
      </header>

      {actionError ? (
        <div className="banner error" role="alert">
          <strong>操作失败</strong>
          <span>{actionError}</span>
          <button className="text-button" type="button" onClick={() => setActionError(undefined)}>
            关闭
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="banner success" role="status">
          <span>{notice}</span>
          <button className="text-button" type="button" onClick={() => setNotice(undefined)}>
            关闭
          </button>
        </div>
      ) : null}

      <section className="board-grid" aria-label="任务看板">
        {COLUMNS.map((status) => {
          const meta = statusMeta(status);
          const columnTasks = tasks.filter((task) => task.status === status);
          return (
            <div className={`board-column status-${meta.className}`} key={status}>
              <div className="column-heading">
                <div>
                  <span className="column-dot" />
                  <h2>{meta.label}</h2>
                </div>
                <span className="column-count">{columnTasks.length}</span>
              </div>
              <p className="column-hint">{meta.hint}</p>
              <div className="column-cards">
                {status === TaskStatus.BACKLOG ? (
                  <NewTaskCard busy={busyId === "__create"} onCreate={createNewTask} />
                ) : null}
                {columnTasks.length === 0 ? (
                  status === TaskStatus.BACKLOG ? null : (
                    <div className="column-empty">
                      <span>
                        {status === TaskStatus.DONE
                          ? "还没有完成记录"
                          : status === TaskStatus.REVIEW
                            ? "暂无待验收"
                            : "暂无任务"}
                      </span>
                    </div>
                  )
                ) : (
                  columnTasks.map((task) => (
                    <TaskCard
                      busy={busyId === task.id}
                      key={task.id}
                      onApprove={(item) => void approveTask(item)}
                      onAccept={(item) => void acceptTask(item)}
                      onComment={commentTask}
                      onComplete={(item) => void completeTask(item)}
                      onCopyInstruction={(item) => void copyInstruction(item)}
                      onDelete={deleteTask}
                      onRelease={(item) => void releaseTask(item)}
                      onUpdate={saveTask}
                      task={task}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="panel board-feed">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Activity</span>
            <h2>这个项目的最近动作</h2>
          </div>
          <span className="count-pill">{activities.length} 条</span>
        </div>
        {activities.length === 0 ? (
          <p className="muted-copy">新任务、认领和完成记录会出现在这里。</p>
        ) : (
          <ol className="timeline">
            {activities.map((activity) => (
              <li key={activity.id}>
                <span className="timeline-icon">
                  {activity.action === "complete" ? (
                    <CheckIcon size={13} />
                  ) : activity.action === "delete" ? (
                    <TrashIcon size={13} />
                  ) : (
                    <SparkIcon size={13} />
                  )}
                </span>
                <div>
                  <p>
                    <b>{activity.actor || "console"}</b> {actionLabel(activity.action)}{" "}
                    <span>#{activity.taskId}</span>
                  </p>
                  <small>
                    {activity.taskTitle} · {formatRelativeTime(activity.createdAt)}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
