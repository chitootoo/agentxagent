"use client";

import type { Activity, Project } from "@axa/proto";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { taskClient } from "@/lib/client";
import { errorMessage, formatRelativeTime, shortPath } from "@/lib/format";
import { actionLabel } from "@/lib/task-meta";
import { ArrowRightIcon, PlusIcon, SparkIcon, TrashIcon } from "./icons";

interface ProjectForm {
  path: string;
  name: string;
  initialize: boolean;
}

const EMPTY_FORM: ProjectForm = { path: "", name: "", initialize: false };

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ProjectForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [projectResponse, activityResponse] = await Promise.all([
        taskClient.listProjects({}),
        taskClient.listActivity({ limit: 8 }),
      ]);
      setProjects(projectResponse.projects);
      setActivities(activityResponse.activities);
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = projects.reduce(
    (acc, project) => ({
      tasks: acc.tasks + project.totalTasks,
      doing: acc.doing + project.doingCount,
      done: acc.done + project.doneCount,
      todo: acc.todo + project.todoCount,
    }),
    { tasks: 0, doing: 0, done: 0, todo: 0 },
  );
  const completion = totals.tasks > 0 ? Math.round((totals.done / totals.tasks) * 100) : 0;

  async function addProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.path.trim()) {
      setFormError("请输入项目目录路径（绝对路径或以 ~/ 开头）。");
      return;
    }
    setAdding(true);
    setFormError(undefined);
    try {
      const response = await taskClient.registerProject({
        path: form.path.trim(),
        name: form.name.trim(),
        initialize: form.initialize,
      });
      if (!response.project) {
        throw new Error("服务端未返回项目信息。");
      }
      setNotice(`已纳管 ${response.project.name}`);
      setForm(EMPTY_FORM);
      setFormOpen(false);
      await load(true);
    } catch (cause) {
      setFormError(errorMessage(cause));
    } finally {
      setAdding(false);
    }
  }

  async function removeProject(project: Project) {
    if (
      !window.confirm(
        `从控制台移除「${project.name}」？\n\n只会取消纳管，不会删除 .axa/ 或任何任务文件。`,
      )
    ) {
      return;
    }
    setRemovingId(project.id);
    try {
      await taskClient.removeProject({ projectId: project.id });
      setNotice(`已取消纳管 ${project.name}`);
      await load(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRemovingId(undefined);
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <div className="skeleton skeleton-title" />
        <div className="stat-grid">
          <div className="skeleton skeleton-stat" />
          <div className="skeleton skeleton-stat" />
          <div className="skeleton skeleton-stat" />
        </div>
        <div className="skeleton skeleton-panel" />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <header className="hero">
        <div>
          <span className="eyebrow">
            <SparkIcon size={14} /> Local task hub
          </span>
          <h1>
            把任务交给 Agent，
            <br />
            把控制权留在本地。
          </h1>
          <p className="hero-copy">
            axa 用一套人类可读的 <code>.axa/</code> 目录协调多个 AI Agent。 文件是真相源，CLI
            是行动接口，控制台负责观察与批准。
          </p>
        </div>
        <div className="hero-actions">
          <button
            className="button primary"
            type="button"
            onClick={() => setFormOpen((open) => !open)}
          >
            <PlusIcon size={16} />
            添加项目
          </button>
          <span className="hero-meta">零云依赖 · 本地 SQLite · 文件优先</span>
        </div>
      </header>

      {error ? (
        <div className="banner error" role="alert">
          <strong>加载失败</strong>
          <span>{error}</span>
          <button className="text-button" type="button" onClick={() => void load()}>
            重试
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

      {formOpen ? (
        <form className="add-project panel" onSubmit={addProject}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Register</span>
              <h2>纳管一个项目</h2>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setFormOpen(false);
                setFormError(undefined);
              }}
            >
              收起
            </button>
          </div>
          <div className="form-grid">
            <label className="field field-wide">
              <span>项目目录</span>
              <input
                placeholder="/path/to/your/project 或 ~/projects/demo"
                value={form.path}
                onChange={(event) => setForm({ ...form, path: event.target.value })}
              />
              <small>axa 会在该目录读取或创建 .axa/ 目录。</small>
            </label>
            <label className="field">
              <span>显示名称</span>
              <input
                placeholder="可选，默认取目录名"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.initialize}
                onChange={(event) => setForm({ ...form, initialize: event.target.checked })}
              />
              <span>
                若目录尚未纳管，自动初始化 <code>.axa/</code>
              </span>
            </label>
          </div>
          {formError ? (
            <p className="inline-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="form-actions">
            <button className="button primary" disabled={adding} type="submit">
              {adding ? "正在注册…" : "注册项目"}
            </button>
            <span className="form-hint">仅读取本地文件，不会上传任何内容。</span>
          </div>
        </form>
      ) : null}

      <section className="stat-grid" aria-label="全局概览">
        <article className="stat-card">
          <span>已纳管项目</span>
          <strong>{projects.length}</strong>
          <small>{projects.filter((project) => project.exists).length} 个路径可用</small>
        </article>
        <article className="stat-card">
          <span>进行中的任务</span>
          <strong>{totals.doing}</strong>
          <small>{totals.todo} 个 todo 等待认领</small>
        </article>
        <article className="stat-card accent">
          <span>完成率</span>
          <strong>{completion}%</strong>
          <small>
            {totals.done} / {totals.tasks} 个任务
          </small>
        </article>
      </section>

      <div className="dashboard-grid">
        <section className="panel projects-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Projects</span>
              <h2>项目看板</h2>
            </div>
            <span className="count-pill">{projects.length} 项</span>
          </div>

          {projects.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">
                <SparkIcon size={22} />
              </span>
              <h3>还没有纳管任何项目</h3>
              <p>
                在已有项目执行 <code>axa init</code>，或点击右上角添加项目。
              </p>
              <button className="button secondary" type="button" onClick={() => setFormOpen(true)}>
                添加第一个项目
              </button>
            </div>
          ) : (
            <div className="project-grid">
              {projects.map((project) => {
                const progress =
                  project.totalTasks > 0
                    ? Math.round((project.doneCount / project.totalTasks) * 100)
                    : 0;
                return (
                  <article
                    className={`project-card${project.exists ? "" : " missing"}`}
                    key={project.id}
                  >
                    <div className="project-top">
                      <div>
                        <span className="project-status">
                          <span className={`local-dot${project.exists ? "" : " offline"}`} />
                          {project.exists ? "Ready" : "Missing"}
                        </span>
                        <h3>{project.name}</h3>
                      </div>
                      <button
                        aria-label={`移除 ${project.name}`}
                        className="icon-button"
                        disabled={removingId === project.id}
                        onClick={() => void removeProject(project)}
                        title="取消纳管（不删除文件）"
                        type="button"
                      >
                        <TrashIcon size={15} />
                      </button>
                    </div>
                    <code className="path" title={project.path}>
                      {shortPath(project.path)}
                    </code>
                    <div className="progress-row">
                      <div className="progress-track">
                        <span style={{ width: `${progress}%` }} />
                      </div>
                      <span>{progress}%</span>
                    </div>
                    <div className="mini-counts">
                      <span>
                        <b>{project.backlogCount}</b> backlog
                      </span>
                      <span>
                        <b>{project.todoCount}</b> todo
                      </span>
                      <span>
                        <b>{project.doingCount}</b> doing
                      </span>
                      <span>
                        <b>{project.doneCount}</b> done
                      </span>
                    </div>
                    {project.exists ? (
                      <Link className="card-link" href={`/projects/${project.id}`}>
                        打开看板 <ArrowRightIcon size={15} />
                      </Link>
                    ) : (
                      <span className="card-link disabled">目录不可用</span>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Live feed</span>
              <h2>最近动态</h2>
            </div>
            <Link className="text-link" href="/activity">
              全部
            </Link>
          </div>
          {activities.length === 0 ? (
            <p className="muted-copy">批准、认领或完成任务后，动态会出现在这里。</p>
          ) : (
            <ol className="activity-list compact">
              {activities.map((activity) => (
                <li key={activity.id}>
                  <span className="activity-dot" />
                  <div>
                    <p>
                      <b>{activity.actor || "console"}</b> {actionLabel(activity.action)}
                    </p>
                    <span className="activity-task">{activity.taskTitle}</span>
                    <small>
                      {activity.projectId} · {formatRelativeTime(activity.createdAt)}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
