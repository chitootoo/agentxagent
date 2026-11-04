"use client";

import { type Project, TaskPriority, TaskStatus } from "@axa/proto";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { taskClient } from "@/lib/client";
import { errorMessage, shortPath } from "@/lib/format";
import { PRIORITY_META } from "@/lib/task-meta";
import { ArrowLeftIcon, CheckIcon, PlusIcon, SparkIcon } from "./icons";

const PRIORITY_OPTIONS = [TaskPriority.P0, TaskPriority.P1, TaskPriority.P2] as const;

export function CreateTaskForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project>();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.P1);
  const [destination, setDestination] = useState<TaskStatus>(TaskStatus.BACKLOG);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    taskClient
      .listProjects({})
      .then((response) => {
        if (cancelled) return;
        const found = response.projects.find((candidate) => candidate.id === projectId);
        if (!found) {
          setError(`项目 ${projectId} 未注册。`);
        } else {
          setProject(found);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("任务标题不能为空。");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await taskClient.createTask({
        projectId,
        title: title.trim(),
        body,
        priority,
        status: destination,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        actor: "console",
      });
      if (!response.task) {
        throw new Error("服务端未返回任务信息。");
      }
      router.push(`/projects/${projectId}?created=${response.task.id}`);
    } catch (cause) {
      setError(errorMessage(cause));
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="breadcrumb">
        <Link href={`/projects/${projectId}`}>
          <ArrowLeftIcon size={15} /> 返回看板
        </Link>
        <span>/</span>
        <span>新建任务</span>
      </div>

      <header className="page-heading">
        <span className="eyebrow">
          <PlusIcon size={14} /> Compose
        </span>
        <h1>写下一个清晰的任务</h1>
        <p>把目标、边界与验收标准写清楚，Agent 才能可靠地接手。</p>
      </header>

      <div className="composer-layout">
        <form className="panel composer-card" onSubmit={submit}>
          <label className="field">
            <span>任务标题</span>
            <input
              className="title-input"
              maxLength={300}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：实现任务依赖关系解析"
              value={title}
            />
            <small>任务编号会由 axa 自动分配，文件名会自动规范化。</small>
          </label>

          <fieldset className="segmented-group">
            <legend>优先级</legend>
            <div className="segmented">
              {PRIORITY_OPTIONS.map((value) => (
                <label
                  className={`segment priority-${PRIORITY_META[value].label.toLowerCase()}`}
                  key={value}
                >
                  <input
                    checked={priority === value}
                    name="priority"
                    onChange={() => setPriority(value)}
                    type="radio"
                  />
                  <strong>{PRIORITY_META[value].label}</strong>
                  <small>{PRIORITY_META[value].hint}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="segmented-group">
            <legend>初始状态</legend>
            <div className="segmented two">
              <label className="segment">
                <input
                  checked={destination === TaskStatus.BACKLOG}
                  name="status"
                  onChange={() => setDestination(TaskStatus.BACKLOG)}
                  type="radio"
                />
                <strong>Backlog</strong>
                <small>先进入待审核池</small>
              </label>
              <label className="segment">
                <input
                  checked={destination === TaskStatus.TODO}
                  name="status"
                  onChange={() => setDestination(TaskStatus.TODO)}
                  type="radio"
                />
                <strong>Todo</strong>
                <small>批准并允许 Agent 认领</small>
              </label>
            </div>
          </fieldset>

          <label className="field">
            <span>标签</span>
            <input
              onChange={(event) => setTags(event.target.value)}
              placeholder="core, cli, console（逗号分隔）"
              value={tags}
            />
          </label>

          <label className="field">
            <span>任务正文</span>
            <textarea
              className="body-input"
              onChange={(event) => setBody(event.target.value)}
              placeholder={"## 目标\n\n描述要解决的问题。\n\n## 验收标准\n\n- [ ] ..."}
              rows={13}
              value={body}
            />
            <small>支持 Markdown。建议写清背景、约束和可验证的完成条件。</small>
          </label>

          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="form-actions">
            <button className="button primary large" disabled={submitting || loading} type="submit">
              <CheckIcon size={16} />
              {submitting ? "正在创建…" : "创建任务"}
            </button>
            <Link className="button ghost" href={`/projects/${projectId}`}>
              取消
            </Link>
          </div>
        </form>

        <aside className="composer-aside">
          <section className="panel project-context">
            <span className="eyebrow">Target project</span>
            <h2>{loading ? "读取中…" : (project?.name ?? projectId)}</h2>
            <code className="path">{project ? shortPath(project.path) : projectId}</code>
            <div className="context-stats">
              <span>
                <b>{project?.backlogCount ?? 0}</b> backlog
              </span>
              <span>
                <b>{project?.todoCount ?? 0}</b> todo
              </span>
              <span>
                <b>{project?.doingCount ?? 0}</b> doing
              </span>
            </div>
          </section>

          <section className="panel tips-card">
            <span className="eyebrow">
              <SparkIcon size={14} /> Workflow
            </span>
            <ol className="flow-list">
              <li>
                <span>01</span>
                <div>
                  <strong>Backlog</strong>
                  <p>新想法与 Agent 提议先进入待审核池。</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Todo</strong>
                  <p>人工批准后，Agent 通过 CLI 原子认领。</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Doing</strong>
                  <p>认领即锁定，其他 Agent 不会重复执行。</p>
                </div>
              </li>
              <li>
                <span>04</span>
                <div>
                  <strong>Done</strong>
                  <p>完成后归档，正文保留实现与验证记录。</p>
                </div>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
