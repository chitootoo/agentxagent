import { TaskPriority, TaskStatus } from "@contagxt/axa-proto";

export const PRIORITY_META: Record<TaskPriority, { label: string; hint: string }> = {
  [TaskPriority.UNSPECIFIED]: { label: "P?", hint: "未设置" },
  [TaskPriority.P0]: { label: "P0", hint: "阻塞 / 最高" },
  [TaskPriority.P1]: { label: "P1", hint: "重要" },
  [TaskPriority.P2]: { label: "P2", hint: "优化 / 长期" },
};

export const PRIORITY_OPTIONS = [TaskPriority.P0, TaskPriority.P1, TaskPriority.P2] as const;

export const STATUS_META: Record<
  TaskStatus,
  { label: string; hint: string; className: string; glyph: string }
> = {
  [TaskStatus.UNSPECIFIED]: { label: "未知", hint: "", className: "backlog", glyph: "?" },
  [TaskStatus.BACKLOG]: { label: "待审核", hint: "待审核", className: "backlog", glyph: "批" },
  [TaskStatus.TODO]: { label: "待认领", hint: "待认领", className: "todo", glyph: "待" },
  [TaskStatus.DOING]: { label: "进行中", hint: "进行中", className: "doing", glyph: "做" },
  [TaskStatus.REVIEW]: { label: "待验收", hint: "待验收", className: "review", glyph: "验" },
  [TaskStatus.DONE]: { label: "已完成", hint: "已完成", className: "done", glyph: "完" },
  [TaskStatus.ARCHIVED]: {
    label: "已归档",
    hint: "已归档",
    className: "archived",
    glyph: "档",
  },
};

export const ACTION_LABELS: Record<string, string> = {
  create: "创建任务",
  update: "编辑任务",
  delete: "删除任务",
  approve: "批准任务",
  claim: "认领任务",
  release: "释放任务",
  complete: "完成任务",
  accept: "验收通过",
  comment: "追加需求",
  summary: "提交汇总",
  release_stale: "释放超时任务",
  archive: "归档任务",
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
