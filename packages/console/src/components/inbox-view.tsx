"use client";

import { type Project, TaskStatus } from "@contagxt/axa-proto";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { taskClient } from "@/lib/client";
import { errorMessage, formatRelativeTime } from "@/lib/format";
import {
  awaitsHumanReply,
  conversationPreview,
  INBOX_FILTERS,
  type InboxFilterKey,
  type InboxItem,
  matchesFilter,
  sortInbox,
} from "@/lib/inbox";
import { taskLink } from "@/lib/project-link";
import { priorityLabel, statusMeta } from "@/lib/task-meta";
import { useActor } from "@/lib/use-actor";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import { useVisiblePolling } from "@/lib/use-visible-polling";
import { ChatIcon, PlusIcon, RefreshIcon } from "./icons";
import { Sheet } from "./sheet";
import { type TaskFormDraft, TaskFormSheet } from "./task-form-sheet";

const ALL_STATUSES = [
  TaskStatus.BACKLOG,
  TaskStatus.TODO,
  TaskStatus.DOING,
  TaskStatus.REVIEW,
  TaskStatus.DONE,
  TaskStatus.ARCHIVED,
] as const;

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"] as const;

interface InboxViewProps {
  initialProjectId?: string;
}

export function InboxView({ initialProjectId }: InboxViewProps) {
  const router = useRouter();
  const { actor, setActor } = useActor();
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState<InboxFilterKey>("attention");
  const [projectFilter, setProjectFilter] = useState(initialProjectId ?? "all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [loadWarning, setLoadWarning] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const projectResponse = await taskClient.listProjects({});
      const results = await Promise.allSettled(
        projectResponse.projects.map(async (project) => {
          const response = await taskClient.listTasks({
            projectId: project.id,
            statuses: [...ALL_STATUSES],
          });
          return response.tasks.map((task) => ({ project, task }));
        }),
      );
      const nextItems = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      setProjects(projectResponse.projects);
      setItems(nextItems);
      setLoadWarning(failed > 0 ? `${failed} 个项目读取失败，其他项目仍然可用。` : undefined);
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useVisiblePolling(() => {
    void load(true);
  }, 5000);

  const { distance, refreshing, pullHandlers } = usePullToRefresh(() => load(true));

  useEffect(() => {
    if (
      projectFilter !== "all" &&
      projects.length > 0 &&
      !projects.some((project) => project.id === projectFilter)
    ) {
      setProjectFilter("all");
    }
  }, [projectFilter, projects]);

  const scopedItems = useMemo(
    () => items.filter((item) => projectFilter === "all" || item.project.id === projectFilter),
    [items, projectFilter],
  );

  const counts = useMemo(() => {
    const next = {} as Record<InboxFilterKey, number>;
    for (const item of INBOX_FILTERS) {
      next[item.key] = scopedItems.filter((entry) => matchesFilter(entry.task, item.key)).length;
    }
    return next;
  }, [scopedItems]);

  const visibleItems = useMemo(
    () => sortInbox(scopedItems.filter((item) => matchesFilter(item.task, filter))),
    [filter, scopedItems],
  );

  const attentionCount = counts.attention;
  const selectedProject =
    projectFilter === "all" ? undefined : projects.find((project) => project.id === projectFilter);

  async function createTask(draft: TaskFormDraft): Promise<boolean> {
    setCreating(true);
    setActionError(undefined);
    setNotice(undefined);
    try {
      const response = await taskClient.createTask({
        projectId: draft.projectId,
        title: draft.title,
        body: draft.body,
        priority: draft.priority,
        status: draft.status ?? TaskStatus.BACKLOG,
        reviewRequired: draft.reviewRequired,
        tags: draft.tags,
        frontmatter: draft.frontmatter,
        actor,
      });
      if (!response.task) throw new Error("服务端未返回新任务。");
      setNotice(`已创建 #${response.task.id}`);
      await load(true);
      router.push(taskLink(draft.projectId, response.task.id));
      return true;
    } catch (cause) {
      setActionError(errorMessage(cause));
      return false;
    } finally {
      setCreating(false);
    }
  }

  async function releaseStale() {
    setReleasing(true);
    setActionError(undefined);
    setNotice(undefined);
    try {
      const targets = selectedProject ? [selectedProject] : projects;
      let released = 0;
      for (const project of targets) {
        const response = await taskClient.releaseStaleTasks({
          projectId: project.id,
          olderThanSeconds: 0,
          actor,
        });
        released += response.released.length;
      }
      setNotice(released > 0 ? `已释放 ${released} 个超时任务` : "没有需要释放的超时任务");
      await load(true);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setReleasing(false);
    }
  }

  return (
    <div className="inbox" {...pullHandlers}>
      <div
        aria-hidden={distance === 0 && !refreshing}
        className={`pull-indicator${refreshing ? " refreshing" : ""}`}
        style={{ height: refreshing ? 44 : distance }}
      >
        {refreshing ? "正在刷新…" : distance >= 56 ? "松开刷新" : "下拉刷新"}
      </div>

      <header className="inbox-header">
        <div className="inbox-heading">
          <div>
            <h1>{selectedProject?.name ?? "任务"}</h1>
            <p>
              {attentionCount > 0
                ? `${attentionCount} 个任务等待你处理`
                : "所有 worker 会话都在这里"}
            </p>
          </div>
          <div className="inbox-header-actions">
            <button
              aria-label="刷新会话"
              className={`icon-button${refreshing ? " spinning" : ""}`}
              disabled={refreshing}
              onClick={() => void load(true)}
              type="button"
            >
              <RefreshIcon size={19} />
            </button>
            <button
              aria-label="收件箱设置"
              className="actor-avatar"
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              {actor.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </div>

        <div className="filter-scroll" role="tablist" aria-label="任务状态">
          {INBOX_FILTERS.map((item) => (
            <button
              aria-selected={filter === item.key}
              className={`filter-chip${filter === item.key ? " active" : ""}`}
              key={item.key}
              onClick={() => setFilter(item.key)}
              role="tab"
              type="button"
            >
              {item.label}
              {counts[item.key] > 0 ? <span>{counts[item.key]}</span> : null}
            </button>
          ))}
        </div>

        <div className="filter-scroll project-chips">
          <button
            className={`project-chip${projectFilter === "all" ? " active" : ""}`}
            onClick={() => setProjectFilter("all")}
            type="button"
          >
            全部项目
          </button>
          {projects.map((project) => (
            <button
              className={`project-chip${projectFilter === project.id ? " active" : ""}${
                project.exists ? "" : " missing"
              }`}
              key={project.id}
              onClick={() => setProjectFilter(project.id)}
              title={project.path}
              type="button"
            >
              <span className={`local-dot${project.exists ? "" : " offline"}`} />
              {project.name}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="banner error" role="alert">
          <strong>加载失败</strong>
          <span>{error}</span>
          <button className="text-button" onClick={() => void load()} type="button">
            重试
          </button>
        </div>
      ) : null}

      {loadWarning ? (
        <p className="inbox-warning" role="status">
          {loadWarning}
        </p>
      ) : null}

      {actionError ? (
        <div className="banner error" role="alert">
          <strong>操作失败</strong>
          <span>{actionError}</span>
          <button className="text-button" onClick={() => setActionError(undefined)} type="button">
            关闭
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="banner success" role="status">
          <span>{notice}</span>
          <button className="text-button" onClick={() => setNotice(undefined)} type="button">
            关闭
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="conversation-list">
          {SKELETON_ROWS.map((row) => (
            <div className="conversation-row skeleton-row" key={row}>
              <span className="skeleton skeleton-avatar" />
              <div className="conversation-copy">
                <span className="skeleton skeleton-line" />
                <span className="skeleton skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="inbox-empty">
          <span className="empty-icon">
            <ChatIcon size={24} />
          </span>
          <h2>还没有可会话的项目</h2>
          <p>先在项目页纳管一个本地项目，任务会自动出现在这里。</p>
          <Link className="button primary" href="/projects">
            去添加项目
          </Link>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="inbox-empty">
          <span className="empty-icon">
            <ChatIcon size={24} />
          </span>
          <h2>{filter === "attention" ? "暂时没有待处理任务" : "这里还没有会话"}</h2>
          <p>
            {filter === "attention"
              ? "需要批准或验收的任务会出现在这里。"
              : "新建一个任务，或在其他筛选中查看已有任务。"}
          </p>
          <button className="button secondary" onClick={() => setNewTaskOpen(true)} type="button">
            新建任务
          </button>
        </div>
      ) : (
        <div className="conversation-list">
          {visibleItems.map((item) => (
            <ConversationRow item={item} key={`${item.project.id}:${item.task.id}`} />
          ))}
        </div>
      )}

      {projects.length > 0 ? (
        <button
          aria-label="新建任务"
          className="inbox-fab"
          onClick={() => setNewTaskOpen(true)}
          type="button"
        >
          <PlusIcon size={24} />
        </button>
      ) : null}

      <Sheet onClose={() => setSettingsOpen(false)} open={settingsOpen} title="收件箱设置">
        <div className="settings-stack">
          <label className="task-edit-field">
            <span>操作人</span>
            <input
              maxLength={60}
              onChange={(event) => setActor(event.target.value)}
              placeholder="Boss"
              value={actor}
            />
            <small>控制台代表 Boss 身份，操作会记录到动态时间线。</small>
          </label>
          <div className="settings-action">
            <div>
              <strong>释放超时任务</strong>
              <p>把认领超过 7 天仍未完成的任务放回待认领。</p>
            </div>
            <button
              className="button ghost"
              disabled={releasing}
              onClick={() => void releaseStale()}
              type="button"
            >
              {releasing ? "释放中…" : "立即释放"}
            </button>
          </div>
        </div>
      </Sheet>

      <TaskFormSheet
        busy={creating}
        defaultProjectId={selectedProject?.id}
        mode="create"
        onClose={() => setNewTaskOpen(false)}
        onSubmit={createTask}
        open={newTaskOpen}
        projects={projects}
      />
    </div>
  );
}

function ConversationRow({ item }: { item: InboxItem }) {
  const { project, task } = item;
  const meta = statusMeta(task.status);
  const priority = priorityLabel(task.priority);
  const reply = awaitsHumanReply(task);

  return (
    <Link
      className={`conversation-row status-${meta.className}`}
      href={taskLink(project.id, task.id)}
    >
      <span className={`conversation-avatar status-${meta.className}`}>
        {meta.glyph}
        {reply ? <span className="reply-dot" /> : null}
      </span>
      <span className="conversation-copy">
        <span className="conversation-line">
          <strong className="conversation-title">{task.title}</strong>
          <time className="conversation-time">{formatRelativeTime(task.updatedAt)}</time>
        </span>
        <span className="conversation-sub">
          <span className="conversation-project">{project.name}</span>
          <span className={`priority priority-${priority.toLowerCase()}`}>{priority}</span>
          <span className={`status-chip status-${meta.className}`}>{meta.hint}</span>
          {task.claimedBy ? <span className="claimed-by">@{task.claimedBy}</span> : null}
        </span>
        <span className="conversation-preview">{conversationPreview(task)}</span>
      </span>
    </Link>
  );
}
