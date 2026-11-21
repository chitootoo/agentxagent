import { ConversationRole, type Project, type Task, TaskStatus } from "@contagxt/axa-proto";

export interface InboxItem {
  project: Project;
  task: Task;
}

export type InboxFilterKey = "attention" | "all" | "active" | "done" | "archived";

export const INBOX_FILTERS: Array<{
  key: InboxFilterKey;
  label: string;
  statuses: TaskStatus[];
}> = [
  {
    key: "attention",
    label: "待处理",
    statuses: [TaskStatus.BACKLOG, TaskStatus.REVIEW],
  },
  {
    key: "all",
    label: "全部",
    statuses: [
      TaskStatus.BACKLOG,
      TaskStatus.TODO,
      TaskStatus.DOING,
      TaskStatus.REVIEW,
      TaskStatus.DONE,
    ],
  },
  {
    key: "active",
    label: "进行中",
    statuses: [TaskStatus.TODO, TaskStatus.DOING],
  },
  {
    key: "done",
    label: "已完成",
    statuses: [TaskStatus.DONE],
  },
  {
    key: "archived",
    label: "已归档",
    statuses: [TaskStatus.ARCHIVED],
  },
];

export function matchesFilter(task: Task, filter: InboxFilterKey): boolean {
  const statuses = INBOX_FILTERS.find((item) => item.key === filter)?.statuses ?? [];
  return statuses.includes(task.status);
}

export function needsHumanAttention(task: Task): boolean {
  return task.status === TaskStatus.BACKLOG || task.status === TaskStatus.REVIEW;
}

export function awaitsHumanReply(task: Task): boolean {
  const latest = task.conversation.at(-1);
  return (
    latest?.role === ConversationRole.AGENT &&
    task.status !== TaskStatus.DONE &&
    task.status !== TaskStatus.ARCHIVED
  );
}

export function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function conversationPreview(task: Task): string {
  const latest = task.conversation.at(-1);
  const body = latest?.body ?? task.body;
  const plain = stripMarkdown(body);
  if (!plain) return "暂无会话内容";
  return plain.length > 80 ? `${plain.slice(0, 80)}…` : plain;
}

export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort(
    (left, right) =>
      new Date(right.task.updatedAt).getTime() - new Date(left.task.updatedAt).getTime(),
  );
}
