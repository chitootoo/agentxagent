"use client";

import { ConversationRole, type Project, type Task, TaskStatus } from "@contagxt/axa-proto";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { taskClient } from "@/lib/client";
import { errorMessage, formatDateTime, formatRelativeTime, shortPath } from "@/lib/format";
import { copyText, taskExecutionPrompt } from "@/lib/instruction";
import { priorityLabel, statusMeta } from "@/lib/task-meta";
import { useActor } from "@/lib/use-actor";
import { useVisiblePolling } from "@/lib/use-visible-polling";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  MoreIcon,
  PencilIcon,
  RefreshIcon,
  SendIcon,
  TrashIcon,
  UndoIcon,
} from "./icons";
import { MarkdownText } from "./markdown-text";
import { Sheet } from "./sheet";
import { type TaskFormDraft, TaskFormSheet } from "./task-form-sheet";

interface TaskConversationProps {
  projectId: string;
  taskId: string;
}

const REOPENING_STATUSES: TaskStatus[] = [TaskStatus.REVIEW, TaskStatus.DONE, TaskStatus.ARCHIVED];

function statusNotice(task: Task): { tone: string; title: string; detail: string } {
  switch (task.status) {
    case TaskStatus.BACKLOG:
      return {
        tone: "attention",
        title: "等待你的批准",
        detail: "批准后任务进入待认领，Agent 才能认领执行。",
      };
    case TaskStatus.TODO:
      return {
        tone: "waiting",
        title: "等待 Agent 认领",
        detail: "可以把执行指令发给 Agent，或等待它主动领取。",
      };
    case TaskStatus.DOING:
      return {
        tone: "working",
        title: task.claimedBy ? `@${task.claimedBy} 正在处理` : "Agent 正在处理",
        detail: task.reviewRequired
          ? "Agent 提交汇总后会进入待验收。"
          : "这个任务无需人工验收，Agent 完成后会直接完成。",
      };
    case TaskStatus.REVIEW:
      return {
        tone: "attention",
        title: "等待你验收",
        detail: "验收通过后任务完成；也可以在下方追加需求让它继续处理。",
      };
    case TaskStatus.DONE:
      return {
        tone: "done",
        title: "任务已完成",
        detail: "追加需求会重新打开任务并回到待认领。",
      };
    case TaskStatus.ARCHIVED:
      return {
        tone: "archived",
        title: "任务已归档",
        detail: "归档是终态；追加需求会重新打开任务。",
      };
    default:
      return { tone: "waiting", title: "任务状态未知", detail: "刷新后再试。" };
  }
}

export function TaskConversation({ projectId, taskId }: TaskConversationProps) {
  const router = useRouter();
  const { actor } = useActor();
  const [task, setTask] = useState<Task>();
  const [project, setProject] = useState<Project>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [metaOpen, setMetaOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const previousCount = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [taskResponse, projectResponse] = await Promise.all([
          taskClient.getTask({ projectId, taskId }),
          taskClient.listProjects({}),
        ]);
        setTask(taskResponse.task);
        setProject(projectResponse.projects.find((entry) => entry.id === projectId));
        setError(undefined);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [projectId, taskId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useVisiblePolling(() => {
    void load(true);
  }, 5000);

  const conversationCount = task?.conversation.length ?? 0;

  useEffect(() => {
    if (!task) return;
    const first = previousCount.current === 0;
    if (first || atBottomRef.current) {
      window.requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (node) {
          node.scrollTo({ top: node.scrollHeight, behavior: first ? "auto" : "smooth" });
        }
      });
    }
    previousCount.current = conversationCount;
  }, [conversationCount, task]);

  async function runAction(action: () => Promise<unknown>, message: string): Promise<boolean> {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setActionError(undefined);
    setNotice(undefined);
    const reopens = task ? REOPENING_STATUSES.includes(task.status) : false;
    try {
      await taskClient.appendTaskMessage({
        projectId,
        taskId,
        role: ConversationRole.USER,
        message,
        actor,
      });
      setDraft("");
      atBottomRef.current = true;
      setNotice(reopens ? "已追加需求，任务重新打开为待认领" : "已追加需求，等待 Agent 继续处理");
      await load(true);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  async function copyInstruction() {
    if (!task || !project?.path) {
      setActionError("项目路径尚未加载，请稍后重试。");
      return;
    }
    setActionError(undefined);
    setNotice(undefined);
    try {
      await copyText(taskExecutionPrompt(task, project.path));
      setNotice(`已复制 #${task.id} 的执行指令，粘贴给 Agent 即可开始。`);
      setMenuOpen(false);
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  }

  async function saveTask(draftValue: TaskFormDraft): Promise<boolean> {
    const saved = await runAction(
      () =>
        taskClient.updateTask({
          projectId,
          taskId,
          title: draftValue.title,
          body: draftValue.body,
          priority: draftValue.priority,
          reviewRequired: draftValue.reviewRequired,
          tags: draftValue.tags,
          frontmatter: draftValue.frontmatter,
          actor,
        }),
      "任务已保存",
    );
    if (saved) setMenuOpen(false);
    return saved;
  }

  async function deleteTask() {
    const removed = await runAction(
      () => taskClient.deleteTask({ projectId, taskId, actor }),
      "任务已删除",
    );
    if (removed) {
      router.replace(`/projects/${projectId}`);
    }
  }

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  if (loading) {
    return (
      <div className="chat chat--loading">
        <div className="skeleton skeleton-title" />
        <div className="chat-scroll">
          <span className="skeleton skeleton-bubble left" />
          <span className="skeleton skeleton-bubble right" />
          <span className="skeleton skeleton-bubble left" />
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="page-stack">
        <div className="panel empty-state">
          <h1>无法打开任务</h1>
          <p>{error ?? "任务可能已被删除。"}</p>
          <Link className="button secondary" href={`/projects/${projectId}`}>
            返回会话列表
          </Link>
        </div>
      </div>
    );
  }

  const meta = statusMeta(task.status);
  const priority = priorityLabel(task.priority);
  const latestRole = task.conversation.at(-1)?.role;
  const canComplete = task.status === TaskStatus.DOING && latestRole === ConversationRole.AGENT;
  const hasPrimary =
    task.status === TaskStatus.BACKLOG ||
    task.status === TaskStatus.TODO ||
    task.status === TaskStatus.REVIEW ||
    (task.status === TaskStatus.DOING && canComplete);
  const noticeCard = statusNotice(task);
  const reopensOnReply = REOPENING_STATUSES.includes(task.status);
  const composerHint = reopensOnReply
    ? "追加需求会把任务重新打开为待认领"
    : task.status === TaskStatus.DOING
      ? "追加需求会直接发给执行中的 Agent"
      : undefined;

  return (
    <div className="chat">
      <header className="chat-head">
        <button aria-label="返回会话列表" className="icon-button" onClick={goBack} type="button">
          <ArrowLeftIcon size={20} />
        </button>
        <div className="chat-head-copy">
          <div className="chat-head-title">
            <h1>{task.title}</h1>
            <span className={`status-chip status-${meta.className}`}>{meta.hint}</span>
          </div>
          <p>
            {project?.name ?? projectId} · #{task.id} · {formatRelativeTime(task.updatedAt)}
          </p>
        </div>
        <button
          aria-label="任务操作"
          className="icon-button"
          onClick={() => setMenuOpen(true)}
          type="button"
        >
          <MoreIcon size={20} />
        </button>
      </header>

      {actionError ? (
        <div className="banner error chat-banner" role="alert">
          <strong>操作失败</strong>
          <span>{actionError}</span>
          <button className="text-button" onClick={() => setActionError(undefined)} type="button">
            关闭
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="banner success chat-banner" role="status">
          <span>{notice}</span>
          <button className="text-button" onClick={() => setNotice(undefined)} type="button">
            关闭
          </button>
        </div>
      ) : null}

      <div
        className="chat-scroll"
        onScroll={(event) => {
          const node = event.currentTarget;
          atBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
        }}
        ref={scrollRef}
      >
        <section className={`chat-context${metaOpen ? " open" : ""}`}>
          <button
            aria-expanded={metaOpen}
            className="chat-context-summary"
            onClick={() => setMetaOpen((current) => !current)}
            type="button"
          >
            <span className={`priority priority-${priority.toLowerCase()}`}>{priority}</span>
            <span className="context-status">{meta.label}</span>
            <span className="context-divider">·</span>
            <span className="context-project">{project?.name ?? projectId}</span>
            {task.claimedBy ? (
              <>
                <span className="context-divider">·</span>
                <span className="context-claim">@{task.claimedBy}</span>
              </>
            ) : null}
            <span className="context-toggle">{metaOpen ? "收起" : "详情"}</span>
          </button>
          {metaOpen ? (
            <div className="chat-context-body">
              <dl>
                <div>
                  <dt>项目</dt>
                  <dd>{project?.name ?? projectId}</dd>
                </div>
                <div>
                  <dt>路径</dt>
                  <dd className="mono">{project ? shortPath(project.path) : "—"}</dd>
                </div>
                <div>
                  <dt>优先级</dt>
                  <dd>
                    {priority} · {statusMeta(task.status).label}
                  </dd>
                </div>
                <div>
                  <dt>验收</dt>
                  <dd>{task.reviewRequired ? "需要人工验收" : "完成后直接完成"}</dd>
                </div>
                <div>
                  <dt>创建</dt>
                  <dd>{formatDateTime(task.createdAt)}</dd>
                </div>
                <div>
                  <dt>更新</dt>
                  <dd>{formatDateTime(task.updatedAt)}</dd>
                </div>
                {task.tags.length > 0 ? (
                  <div>
                    <dt>标签</dt>
                    <dd className="meta-tags">
                      {task.tags.map((tag) => (
                        <span className="tag-chip" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {task.frontmatter.trim() ? (
                <pre className="meta-frontmatter">{task.frontmatter}</pre>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="chat-stream">
          {task.conversation.length === 0 ? (
            <div className="chat-line from-agent">
              <article className="chat-bubble">
                <div className="bubble-meta">
                  <span>任务正文</span>
                </div>
                <MarkdownText text={task.body || "暂无内容"} />
              </article>
            </div>
          ) : (
            task.conversation.map((entry) => {
              const fromUser = entry.role === ConversationRole.USER;
              return (
                <div
                  className={`chat-line ${fromUser ? "from-user" : "from-agent"}`}
                  key={entry.seq}
                >
                  <article className="chat-bubble">
                    <div className="bubble-meta">
                      <span>{fromUser ? actor : entry.agent || "Agent"}</span>
                      {entry.title ? <span className="bubble-title">{entry.title}</span> : null}
                      <code>#{entry.seq}</code>
                    </div>
                    <MarkdownText text={entry.body} />
                  </article>
                </div>
              );
            })
          )}
        </div>

        <div className={`chat-status ${noticeCard.tone}`}>
          <span className={`status-glyph status-${meta.className}`}>{meta.glyph}</span>
          <div>
            <strong>{noticeCard.title}</strong>
            <p>{noticeCard.detail}</p>
          </div>
        </div>
      </div>

      <footer className="chat-foot">
        {hasPrimary ? (
          <div className="chat-actions">
            {task.status === TaskStatus.BACKLOG ? (
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    () => taskClient.approveTask({ projectId, taskId, actor }),
                    "已批准，任务进入待认领",
                  )
                }
                type="button"
              >
                <CheckIcon size={16} /> 批准任务
              </button>
            ) : null}

            {task.status === TaskStatus.TODO ? (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void copyInstruction()}
                type="button"
              >
                <CopyIcon size={16} /> 复制执行指令
              </button>
            ) : null}

            {task.status === TaskStatus.DOING && canComplete ? (
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    () => taskClient.completeTask({ projectId, taskId, actor }),
                    task.reviewRequired ? "已提交验收" : "任务已完成",
                  )
                }
                type="button"
              >
                <CheckIcon size={16} /> {task.reviewRequired ? "提交验收" : "完成任务"}
              </button>
            ) : null}

            {task.status === TaskStatus.REVIEW ? (
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    () => taskClient.acceptTask({ projectId, taskId, actor }),
                    "验收通过，任务已完成",
                  )
                }
                type="button"
              >
                <CheckIcon size={16} /> 验收通过
              </button>
            ) : null}

            {task.status === TaskStatus.DOING ? (
              <button
                className="button ghost"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    () => taskClient.releaseTask({ projectId, taskId, actor }),
                    "已释放任务",
                  )
                }
                type="button"
              >
                <UndoIcon size={16} /> 释放
              </button>
            ) : null}
          </div>
        ) : null}

        <form className="chat-composer" onSubmit={send}>
          <textarea
            aria-label="追加需求"
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={reopensOnReply ? "追加需求，重新打开任务…" : "追加需求，发给 Agent…"}
            rows={1}
            value={draft}
          />
          <button
            aria-label="发送"
            className="send-button"
            disabled={sending || draft.trim().length === 0}
            type="submit"
          >
            <SendIcon size={19} />
          </button>
        </form>
        {composerHint ? <p className="composer-hint">{composerHint}</p> : null}
      </footer>

      <Sheet onClose={() => setMenuOpen(false)} open={menuOpen} title="任务操作">
        <div className="menu-list">
          <button
            className="menu-row"
            onClick={() => {
              setMenuOpen(false);
              setEditOpen(true);
            }}
            type="button"
          >
            <span className="menu-icon">
              <PencilIcon size={18} />
            </span>
            <span className="menu-copy">
              <strong>编辑任务</strong>
              <small>标题、优先级、正文与验收设置</small>
            </span>
            <ArrowRightIcon size={16} />
          </button>
          <button className="menu-row" onClick={() => void copyInstruction()} type="button">
            <span className="menu-icon">
              <CopyIcon size={18} />
            </span>
            <span className="menu-copy">
              <strong>复制执行指令</strong>
              <small>把任务交给新的 Agent 会话</small>
            </span>
            <ArrowRightIcon size={16} />
          </button>
          <button className="menu-row" onClick={() => void load(true)} type="button">
            <span className="menu-icon">
              <RefreshIcon size={18} />
            </span>
            <span className="menu-copy">
              <strong>刷新会话</strong>
              <small>立即拉取最新会话记录</small>
            </span>
            <ArrowRightIcon size={16} />
          </button>
          {task.status === TaskStatus.DOING ? (
            <button
              className="menu-row"
              onClick={async () => {
                const released = await runAction(
                  () => taskClient.releaseTask({ projectId, taskId, actor }),
                  "已释放任务",
                );
                if (released) setMenuOpen(false);
              }}
              type="button"
            >
              <span className="menu-icon">
                <UndoIcon size={18} />
              </span>
              <span className="menu-copy">
                <strong>释放任务</strong>
                <small>把任务放回待认领，允许重新认领</small>
              </span>
              <ArrowRightIcon size={16} />
            </button>
          ) : null}
          <button
            className="menu-row danger"
            onClick={() => {
              setMenuOpen(false);
              setDeleteOpen(true);
            }}
            type="button"
          >
            <span className="menu-icon">
              <TrashIcon size={18} />
            </span>
            <span className="menu-copy">
              <strong>删除任务</strong>
              <small>移除整个任务文件夹，无法恢复</small>
            </span>
            <ArrowRightIcon size={16} />
          </button>
        </div>
      </Sheet>

      <TaskFormSheet
        busy={busy}
        defaultProjectId={projectId}
        mode="edit"
        onClose={() => setEditOpen(false)}
        onSubmit={saveTask}
        open={editOpen}
        projects={project ? [project] : []}
        task={task}
      />

      <Sheet
        footer={
          <div className="sheet-actions">
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void deleteTask()}
              type="button"
            >
              <TrashIcon size={15} /> {busy ? "删除中…" : "确认删除"}
            </button>
            <button
              className="button ghost"
              disabled={busy}
              onClick={() => setDeleteOpen(false)}
              type="button"
            >
              取消
            </button>
          </div>
        }
        onClose={() => setDeleteOpen(false)}
        open={deleteOpen}
        title={`删除 #${task.id}`}
      >
        <p className="muted-copy">
          删除「{task.title}」会移除任务文件夹和全部会话记录，且无法从控制台恢复。
        </p>
      </Sheet>
    </div>
  );
}
