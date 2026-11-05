"use client";

import { TaskPriority } from "@contagxt/axa-proto";
import { useEffect, useRef, useState } from "react";
import { PRIORITY_META, PRIORITY_OPTIONS } from "@/lib/task-meta";

export interface TaskFormValue {
  title: string;
  body: string;
  priority: TaskPriority;
  reviewRequired: boolean;
  tags: string;
  frontmatter: string;
}

export const EMPTY_TASK_FORM: TaskFormValue = {
  title: "",
  body: "",
  priority: TaskPriority.P1,
  reviewRequired: true,
  tags: "",
  frontmatter: "",
};

interface TaskFormFieldsProps {
  value: TaskFormValue;
  onChange: (value: TaskFormValue) => void;
  autoFocus?: boolean;
}

export function TaskFormFields({ value, onChange, autoFocus = false }: TaskFormFieldsProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [showFrontmatter, setShowFrontmatter] = useState(value.frontmatter.trim().length > 0);

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  function update<K extends keyof TaskFormValue>(key: K, next: TaskFormValue[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="task-editor-fields">
      <label className="task-edit-field">
        <span>标题</span>
        <input
          className="task-title-input"
          maxLength={300}
          onChange={(event) => update("title", event.target.value)}
          placeholder="一句话说明要完成什么"
          ref={titleRef}
          value={value.title}
        />
      </label>

      <div className="task-edit-row">
        <label className="task-edit-field">
          <span>优先级</span>
          <select
            onChange={(event) => update("priority", Number(event.target.value) as TaskPriority)}
            value={value.priority}
          >
            {PRIORITY_OPTIONS.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_META[priority].label} · {PRIORITY_META[priority].hint}
              </option>
            ))}
          </select>
        </label>
        <label className="task-edit-field">
          <span>标签</span>
          <input
            onChange={(event) => update("tags", event.target.value)}
            placeholder="core, console（逗号分隔）"
            value={value.tags}
          />
        </label>
      </div>

      <label className="task-review-option">
        <input
          checked={!value.reviewRequired}
          onChange={(event) => update("reviewRequired", !event.target.checked)}
          type="checkbox"
        />
        <span>
          无需review
          <small>默认任务完成后进入“待验收”，人工验收通过才计入完成；勾选后直接完成。</small>
        </span>
      </label>

      <div className="task-frontmatter-block">
        <button
          className="text-button task-frontmatter-toggle"
          onClick={() => setShowFrontmatter((current) => !current)}
          type="button"
        >
          {showFrontmatter ? "收起 Frontmatter" : "编辑 Frontmatter"}
        </button>
        {showFrontmatter ? (
          <label className="task-edit-field">
            <textarea
              className="task-frontmatter-input"
              onChange={(event) => update("frontmatter", event.target.value)}
              placeholder={"assignee: alice\nissue: 123"}
              rows={5}
              spellCheck={false}
              value={value.frontmatter}
            />
            <small>额外字段使用 YAML；编号、优先级、状态由文件路径决定，无需填写。</small>
          </label>
        ) : null}
      </div>

      <label className="task-edit-field">
        <span>正文</span>
        <textarea
          className="task-body-input"
          onChange={(event) => update("body", event.target.value)}
          placeholder={"## 目标\n\n描述要解决的问题。\n\n## 验收标准\n\n- [ ] ..."}
          rows={8}
          value={value.body}
        />
      </label>
    </div>
  );
}
