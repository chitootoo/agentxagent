"use client";

import type { Activity, Project } from "@contagxt/axa-proto";
import { useCallback, useEffect, useState } from "react";
import { taskClient } from "@/lib/client";
import { errorMessage, formatDateTime, formatRelativeTime } from "@/lib/format";
import { actionLabel } from "@/lib/task-meta";
import { CheckIcon, SparkIcon } from "./icons";

export function ActivityView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const loadProjects = useCallback(async () => {
    try {
      const response = await taskClient.listProjects({});
      setProjects(response.projects);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  const loadActivities = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const response = await taskClient.listActivity({ projectId, limit: 100 });
      setActivities(response.activities);
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadActivities(filter);
  }, [filter, loadActivities]);

  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? id;

  return (
    <div className="page-stack">
      <header className="page-heading split">
        <div>
          <span className="eyebrow">
            <SparkIcon size={14} /> Audit trail
          </span>
          <h1>本地操作动态</h1>
          <p>所有状态流转都发生在你的机器上，并记录到本地 SQLite。</p>
        </div>
        <label className="filter-field">
          <span>项目</span>
          <select onChange={(event) => setFilter(event.target.value)} value={filter}>
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? (
        <div className="banner error" role="alert">
          <strong>加载失败</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section className="panel activity-page">
        {loading ? (
          <div className="activity-loading">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
          </div>
        ) : activities.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">
              <SparkIcon size={22} />
            </span>
            <h2>暂无动作记录</h2>
            <p>通过控制台或 CLI 创建、批准、认领、完成任务后，这里会出现时间线。</p>
          </div>
        ) : (
          <ol className="timeline large">
            {activities.map((activity) => (
              <li key={activity.id}>
                <span className={`timeline-icon action-${activity.action}`}>
                  {activity.action === "complete" ? (
                    <CheckIcon size={14} />
                  ) : (
                    <SparkIcon size={14} />
                  )}
                </span>
                <div className="timeline-body">
                  <div className="timeline-title">
                    <b>{activity.actor || "console"}</b>
                    <span className="action-chip">{actionLabel(activity.action)}</span>
                    <code>{activity.projectId}</code>
                  </div>
                  <p>{activity.taskTitle}</p>
                  <small>
                    #{activity.taskId} · {projectName(activity.projectId)} ·{" "}
                    {formatRelativeTime(activity.createdAt)} · {formatDateTime(activity.createdAt)}
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
