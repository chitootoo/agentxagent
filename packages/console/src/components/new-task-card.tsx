"use client";

import { type TaskPriority, TaskStatus } from "@contagxt/axa-proto";
import type { FormEvent, KeyboardEvent } from "react";
import { useState } from "react";
import { CheckIcon, PlusIcon } from "./icons";
import { EMPTY_TASK_FORM, TaskFormFields, type TaskFormValue } from "./task-editor";

export interface NewTaskDraft {
  title: string;
  body: string;
  priority: TaskPriority;
  reviewRequired: boolean;
  tags: string[];
  frontmatter: string;
  status: TaskStatus.BACKLOG | TaskStatus.TODO;
}

interface NewTaskCardProps {
  busy: boolean;
  onCreate: (draft: NewTaskDraft) => Promise<boolean>;
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function NewTaskCard({ busy, onCreate }: NewTaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState<TaskFormValue>(EMPTY_TASK_FORM);
  const [destination, setDestination] = useState<TaskStatus.BACKLOG | TaskStatus.TODO>(
    TaskStatus.BACKLOG,
  );

  function reset() {
    setValue(EMPTY_TASK_FORM);
    setDestination(TaskStatus.BACKLOG);
  }

  function collapse() {
    reset();
    setExpanded(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await onCreate({
      title: value.title.trim(),
      body: value.body,
      priority: value.priority,
      reviewRequired: value.reviewRequired,
      tags: parseTags(value.tags),
      frontmatter: value.frontmatter,
      status: destination,
    });
    if (created) collapse();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      collapse();
    }
  }

  if (!expanded) {
    return (
      <article className="task-card add-card">
        <button className="add-card-trigger" onClick={() => setExpanded(true)} type="button">
          <span className="add-card-plus">
            <PlusIcon size={16} />
          </span>
          <span className="add-card-copy">
            <strong>新建任务</strong>
            <small>直接在这里写下目标与验收标准</small>
          </span>
        </button>
      </article>
    );
  }

  return (
    <article className="task-card add-card editing">
      <form className="task-editor" onKeyDown={handleKeyDown} onSubmit={submit}>
        <div className="task-editor-heading">
          <PlusIcon size={15} /> 新建任务
        </div>
        <TaskFormFields autoFocus onChange={setValue} value={value} />
        <fieldset className="segmented-group">
          <legend>创建到</legend>
          <div className="segmented two">
            <label className="segment">
              <input
                checked={destination === TaskStatus.BACKLOG}
                name="destination"
                onChange={() => setDestination(TaskStatus.BACKLOG)}
                type="radio"
              />
              <strong>Backlog</strong>
              <small>先进入待审核池</small>
            </label>
            <label className="segment">
              <input
                checked={destination === TaskStatus.TODO}
                name="destination"
                onChange={() => setDestination(TaskStatus.TODO)}
                type="radio"
              />
              <strong>Todo</strong>
              <small>批准并允许 Agent 认领</small>
            </label>
          </div>
        </fieldset>
        <div className="task-editor-actions">
          <button className="button tiny primary" disabled={busy} type="submit">
            <CheckIcon size={14} /> {busy ? "创建中…" : "创建任务"}
          </button>
          <button className="button tiny ghost" disabled={busy} onClick={collapse} type="button">
            取消
          </button>
          <span className="task-editor-hint">Esc 取消</span>
        </div>
      </form>
    </article>
  );
}
