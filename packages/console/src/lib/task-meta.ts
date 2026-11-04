import { TaskPriority, TaskStatus } from "@axa/proto";

export const PRIORITY_META: Record<TaskPriority, { label: string; hint: string }> = {
  [TaskPriority.UNSPECIFIED]: { label: "P?", hint: "未设置" },
  [TaskPriority.P0]: { label: "P0", hint: "阻塞 / 最高" },
  [TaskPriority.P1]: { label: "P1", hint: "重要" },
  [TaskPriority.P2]: { label: "P2", hint: "优化 / 长期" },
};

export const STATUS_META: Record<TaskStatus, { label: string; hint: string; className: string }> = {
  [TaskStatus.UNSPECIFIED]: { label: "未知", hint: "", className: "backlog" },
  [TaskStatus.BACKLOG]: { label: "Backlog", hint: "待审核", className: "backlog" },
  [TaskStatus.TODO]: { label: "Todo", hint: "可认领", className: "todo" },
  [TaskStatus.DOING]: { label: "Doing", hint: "进行中", className: "doing" },
  [TaskStatus.DONE]: { label: "Done", hint: "已完成", className: "done" },
};

export const ACTION_LABELS: Record<string, string> = {
  create: "创建任务",
  approve: "批准任务",
  claim: "认领任务",
  release: "释放任务",
  complete: "完成任务",
  reclaim: "回收任务",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function priorityLabel(priority: TaskPriority): string {
  return PRIORITY_META[priority]?.label ?? "P?";
}

export function statusMeta(status: TaskStatus) {
  return STATUS_META[status] ?? STATUS_META[TaskStatus.BACKLOG];
}
