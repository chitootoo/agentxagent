import { type Task, TaskStatus } from "@contagxt/axa-proto";
import { formatRelativeTime } from "@/lib/format";
import { priorityLabel, statusMeta } from "@/lib/task-meta";
import { CheckIcon, PlayIcon, UndoIcon } from "./icons";

interface TaskCardProps {
  task: Task;
  busy: boolean;
  onApprove: (task: Task) => void;
  onClaim: (task: Task) => void;
  onRelease: (task: Task) => void;
  onComplete: (task: Task) => void;
}

function excerpt(body: string): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 132 ? `${plain.slice(0, 132)}…` : plain;
}

export function TaskCard({ task, busy, onApprove, onClaim, onRelease, onComplete }: TaskCardProps) {
  const status = statusMeta(task.status);
  const preview = excerpt(task.body);
  const priority = priorityLabel(task.priority);

  return (
    <article className={`task-card status-${status.className}`}>
      <div className="task-meta">
        <span className={`priority priority-${priority.toLowerCase()}`}>{priority}</span>
        <span className="task-id">#{task.id}</span>
      </div>
      <h3>{task.title}</h3>
      {preview ? <p className="task-excerpt">{preview}</p> : null}

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

      {task.status !== TaskStatus.DONE ? (
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
              onClick={() => onClaim(task)}
              type="button"
            >
              <PlayIcon size={14} /> 认领
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
