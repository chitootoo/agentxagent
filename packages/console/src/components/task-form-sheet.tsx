"use client";

import type { Project, Task, TaskPriority } from "@contagxt/axa-proto";
import { TaskStatus } from "@contagxt/axa-proto";
import { type FormEvent, useEffect, useState } from "react";
import { CheckIcon } from "./icons";
import { Sheet } from "./sheet";
import { EMPTY_TASK_FORM, TaskFormFields, type TaskFormValue } from "./task-editor";

export interface TaskFormDraft {
  projectId: string;
  title: string;
  body: string;
  priority: TaskPriority;
  reviewRequired: boolean;
  tags: string[];
  frontmatter: string;
  status?: TaskStatus.BACKLOG | TaskStatus.TODO;
}

interface TaskFormSheetProps {
  mode: "create" | "edit";
  open: boolean;
  busy: boolean;
  projects: Project[];
  defaultProjectId?: string | undefined;
  task?: Task;
  onClose: () => void;
  onSubmit: (draft: TaskFormDraft) => Promise<boolean>;
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function TaskFormSheet({
  mode,
  open,
  busy,
  projects,
  defaultProjectId,
  task,
  onClose,
  onSubmit,
}: TaskFormSheetProps) {
  const [value, setValue] = useState<TaskFormValue>(EMPTY_TASK_FORM);
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [destination, setDestination] = useState<TaskStatus.BACKLOG | TaskStatus.TODO>(
    TaskStatus.BACKLOG,
  );
  const [error, setError] = useState<string>();

  // Reset only when the sheet opens or switches task; polling refreshes must not
  // overwrite edits the user is still typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: task fields are keyed by id on purpose
  useEffect(() => {
    if (!open) return;
    setError(undefined);
    if (mode === "edit" && task) {
      setValue({
        title: task.title,
        body: task.body,
        priority: task.priority,
        reviewRequired: task.reviewRequired,
        tags: task.tags.join(", "),
        frontmatter: task.frontmatter,
      });
      setProjectId(defaultProjectId ?? "");
      return;
    }
    setValue(EMPTY_TASK_FORM);
    setProjectId(defaultProjectId ?? projects[0]?.id ?? "");
    setDestination(TaskStatus.BACKLOG);
  }, [open, mode, task?.id, defaultProjectId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.title.trim()) {
      setError("任务标题不能为空。");
      return;
    }
    if (!projectId) {
      setError("请选择所属项目。");
      return;
    }
    const saved = await onSubmit({
      projectId,
      title: value.title.trim(),
      body: value.body,
      priority: value.priority,
      reviewRequired: value.reviewRequired,
      tags: parseTags(value.tags),
      frontmatter: value.frontmatter,
      ...(mode === "create" ? { status: destination } : {}),
    });
    if (saved) onClose();
  }

  return (
    <Sheet
      footer={
        <div className="sheet-actions">
          <button className="button primary" disabled={busy} form="task-form-sheet" type="submit">
            <CheckIcon size={15} />
            {busy ? "保存中…" : mode === "create" ? "创建任务" : "保存修改"}
          </button>
          <button className="button ghost" disabled={busy} onClick={onClose} type="button">
            取消
          </button>
        </div>
      }
      onClose={onClose}
      open={open}
      title={mode === "create" ? "新建任务" : `编辑 #${task?.id ?? ""}`}
    >
      <form className="task-form-sheet" id="task-form-sheet" onSubmit={submit}>
        {mode === "create" ? (
          <div className="task-form-create-row">
            <label className="task-edit-field">
              <span>所属项目</span>
              <select onChange={(event) => setProjectId(event.target.value)} value={projectId}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="task-destination">
              <legend>创建到</legend>
              <div className="segmented two">
                <label className="segment">
                  <input
                    checked={destination === TaskStatus.BACKLOG}
                    name="destination"
                    onChange={() => setDestination(TaskStatus.BACKLOG)}
                    type="radio"
                  />
                  <strong>待审核</strong>
                  <small>等待人工批准</small>
                </label>
                <label className="segment">
                  <input
                    checked={destination === TaskStatus.TODO}
                    name="destination"
                    onChange={() => setDestination(TaskStatus.TODO)}
                    type="radio"
                  />
                  <strong>待认领</strong>
                  <small>可直接认领</small>
                </label>
              </div>
            </fieldset>
          </div>
        ) : null}

        <TaskFormFields autoFocus onChange={setValue} value={value} />

        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
