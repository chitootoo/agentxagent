"use client";

import { type Task, TaskPriority, TaskStatus } from "@contagxt/axa-proto";
import type { FormEvent, KeyboardEvent } from "react";
import { useState } from "react";
import { formatRelativeTime } from "@/lib/format";
import { priorityLabel, statusMeta } from "@/lib/task-meta";
import { CheckIcon, CopyIcon, TrashIcon, UndoIcon } from "./icons";
import { TaskFormFields, type TaskFormValue } from "./task-editor";

export interface TaskDraft {
  title: string;
  body: string;
  priority: TaskPriority;
  reviewRequired: boolean;
  tags: string[];
  frontmatter: string;
}

interface TaskCardProps {
  task: Task;
  busy: boolean;
  onApprove: (task: Task) => void;
  onAccept: (task: Task) => void;
  onCopyInstruction: (task: Task) => void;
  onRelease: (task: Task) => void;
  onComplete: (task: Task) => void;
  onDelete: (task: Task) => Promise<boolean>;
  onUpdate: (task: Task, draft: TaskDraft) => Promise<boolean>;
}

function excerpt(body: string): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 132 ? `${plain.slice(0, 132)}…` : plain;
}

function initialForm(task: Task): TaskFormValue {
  return {
    title: task.title,
    body: task.body,
    priority: task.priority === TaskPriority.UNSPECIFIED ? TaskPriority.P1 : task.priority,
    reviewRequired: task.reviewRequired,
    tags: task.tags.join(", "),
    frontmatter: task.frontmatter,
  };
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function TaskCard({
  task,
  busy,
  onApprove,
  onAccept,
  onCopyInstruction,
  onRelease,
  onComplete,
  onDelete,
  onUpdate,
}: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<TaskFormValue>(() => initialForm(task));

  const status = statusMeta(task.status);
  const preview = excerpt(task.body);
  const priority = priorityLabel(task.priority);

  function startEditing() {
    setConfirmingDelete(false);
    setDraft(initialForm(task));
    setEditing(true);
  }

  async function confirmDelete() {
    const deleted = await onDelete(task);
    if (!deleted) setConfirmingDelete(false);
  }

  function cancelEditing() {
    setEditing(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await onUpdate(task, {
      title: draft.title,
      body: draft.body,
      priority: draft.priority,
      reviewRequired: draft.reviewRequired,
      tags: parseTags(draft.tags),
      frontmatter: draft.frontmatter,
    });
    if (saved) setEditing(false);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  return (
    <article
      className={`task-card status-${status.className}${editing ? " editing" : ""}`}
      data-task-id={task.id}
    >
      <div className="task-meta">
        <span className={`priority priority-${priority.toLowerCase()}`}>{priority}</span>
        {task.status === TaskStatus.REVIEW ? <span className="review-badge">待验收</span> : null}
        <div className="task-meta-side">
          <span className="task-id">#{task.id}</span>
          {editing ? null : (
            <button
              aria-label={`删除任务 #${task.id}`}
              className="icon-button task-delete"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
              title="删除任务"
              type="button"
            >
              <TrashIcon size={13} />
            </button>
          )}
        </div>
      </div>

      {confirmingDelete ? (
        <div className="task-delete-confirm" role="alert">
          <span>删除 #{task.id}？任务文件会从项目中移除。</span>
          <div className="task-delete-confirm-actions">
            <button
              className="button tiny danger"
              disabled={busy}
              onClick={() => void confirmDelete()}
              type="button"
            >
              {busy ? "删除中…" : "确认删除"}
            </button>
            <button
              className="button tiny ghost"
              disabled={busy}
              onClick={() => setConfirmingDelete(false)}
              type="button"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <form className="task-editor" onKeyDown={handleEditorKeyDown} onSubmit={submit}>
          <TaskFormFields autoFocus onChange={setDraft} value={draft} />
          <div className="task-editor-actions">
            <button className="button tiny primary" disabled={busy} type="submit">
              {busy ? "保存中…" : "保存"}
            </button>
            <button
              className="button tiny ghost"
              disabled={busy}
              onClick={cancelEditing}
              type="button"
            >
              取消
            </button>
            <span className="task-editor-hint">Esc 取消</span>
          </div>
        </form>
      ) : (
        <>
          <button className="task-title" onClick={startEditing} title="点击编辑" type="button">
            {task.title}
          </button>
          <button
            className={`task-excerpt${preview ? "" : " empty"}`}
            onClick={startEditing}
            title="点击编辑正文"
            type="button"
          >
            {preview || "暂无正文，点击补充"}
          </button>
        </>
      )}

      {task.tags.length > 0 ? (
        <div className="tag-row">
          {task.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="task-footer">
        <div className="task-people">
          {task.claimedBy ? <span>@{task.claimedBy}</span> : <span className="muted">未认领</span>}
          {task.completedBy ? <span>完成 @{task.completedBy}</span> : null}
        </div>
        <span className="task-time">{formatRelativeTime(task.updatedAt)}</span>
      </div>

      {editing ? null : task.status === TaskStatus.REVIEW ? (
        <div className="task-actions">
          <button
            className="button tiny primary"
            disabled={busy}
            onClick={() => onAccept(task)}
            type="button"
          >
            <CheckIcon size={14} /> 验收通过
          </button>
          {busy ? <span className="task-busy">处理中…</span> : null}
        </div>
      ) : task.status !== TaskStatus.DONE ? (
        <div className="task-actions">
          {task.status === TaskStatus.BACKLOG ? (
            <button
              className="button tiny"
              disabled={busy}
              onClick={() => onApprove(task)}
              type="button"
            >
              <CheckIcon size={14} /> 批准
            </button>
          ) : null}
          {task.status === TaskStatus.TODO ? (
            <button
              className="button tiny primary"
              disabled={busy}
              onClick={() => onCopyInstruction(task)}
              title={`复制执行指令，粘贴给 Agent 即可开始 #${task.id}`}
              type="button"
            >
              <CopyIcon size={14} /> 执行指令
            </button>
          ) : null}
          {task.status === TaskStatus.DOING ? (
            <>
              <button
                className="button tiny primary"
                disabled={busy}
                onClick={() => onComplete(task)}
                type="button"
              >
                <CheckIcon size={14} /> 完成
              </button>
              <button
                className="button tiny ghost"
                disabled={busy}
                onClick={() => onRelease(task)}
                type="button"
              >
                <UndoIcon size={14} /> 释放
              </button>
            </>
          ) : null}
          {busy ? <span className="task-busy">处理中…</span> : null}
        </div>
      ) : (
        <div className="task-actions done-mark">
          <CheckIcon size={14} />
          {task.completedAt ? `完成于 ${formatRelativeTime(task.completedAt)}` : "已完成"}
        </div>
      )}
    </article>
  );
}
