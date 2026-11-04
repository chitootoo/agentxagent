import type { ListProjectsResult, Task, TaskPriority, TaskStatus } from "@axa/core";
import pc from "picocolors";

const STATUS_COLORS: Record<TaskStatus, (value: string) => string> = {
  backlog: pc.gray,
  todo: pc.cyan,
  doing: pc.yellow,
  done: pc.green,
};

const PRIORITY_COLORS: Record<TaskPriority, (value: string) => string> = {
  P0: pc.red,
  P1: pc.yellow,
  P2: pc.gray,
};

export function formatDate(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function printTaskTable(tasks: Task[]): void {
  if (tasks.length === 0) {
    console.log(pc.dim("No tasks found."));
    return;
  }

  const header = ["ID", "P", "STATUS", "TITLE", "CLAIMED BY"];
  const rows = tasks.map((task) => [
    task.id,
    task.priority,
    task.status,
    task.title,
    task.claimedBy ?? "-",
  ]);
  const widths = header.map((_, index) =>
    Math.max(...[header, ...rows].map((row) => [...(row[index] ?? "")].length)),
  );

  console.log(
    header
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd(),
  );
  tasks.forEach((task, rowIndex) => {
    const cells = rows[rowIndex] ?? [];
    console.log(
      [
        (cells[0] ?? "").padEnd(widths[0] ?? 0),
        PRIORITY_COLORS[task.priority]((cells[1] ?? "").padEnd(widths[1] ?? 0)),
        STATUS_COLORS[task.status]((cells[2] ?? "").padEnd(widths[2] ?? 0)),
        (cells[3] ?? "").padEnd(widths[3] ?? 0),
        (cells[4] ?? "").padEnd(widths[4] ?? 0),
      ]
        .join("  ")
        .trimEnd(),
    );
  });
}

export function printTask(task: Task): void {
  console.log(pc.bold(`${task.id} · ${task.title}`));
  console.log(
    `${PRIORITY_COLORS[task.priority](task.priority)}  ${STATUS_COLORS[task.status](task.status)}  ${pc.dim(task.filename)}`,
  );
  console.log(pc.dim(task.filePath));
  if (task.claimedBy) {
    console.log(`Claimed by ${pc.bold(task.claimedBy)} at ${formatDate(task.claimedAt)}`);
  }
  console.log(`Created ${formatDate(task.createdAt)} · Updated ${formatDate(task.updatedAt)}`);
  if (task.tags.length > 0) {
    console.log(`Tags: ${task.tags.join(", ")}`);
  }
  if (task.body) {
    console.log(`\n${task.body}`);
  }
}

export function printProjects(projects: ListProjectsResult[]): void {
  if (projects.length === 0) {
    console.log(pc.dim('No projects registered. Run "axa projects add <path>".'));
    return;
  }
  for (const project of projects) {
    const missing = project.exists ? "" : pc.red(" [missing]");
    const counts = `${project.counts.todo} todo · ${project.counts.doing} doing · ${project.counts.done} done`;
    console.log(`${pc.bold(project.id)}  ${project.name}${missing}`);
    console.log(`  ${pc.dim(project.path)}`);
    console.log(`  ${counts} · ${project.counts.backlog} backlog`);
  }
}

export function printBoard(tasks: Task[]): void {
  for (const status of ["backlog", "todo", "doing", "done"] as const) {
    const group = tasks.filter((task) => task.status === status);
    console.log(`\n${STATUS_COLORS[status](status.toUpperCase())} ${pc.dim(`(${group.length})`)}`);
    if (group.length === 0) {
      console.log(pc.dim("  —"));
      continue;
    }
    for (const task of group) {
      const claim = task.claimedBy ? pc.dim(` @${task.claimedBy}`) : "";
      console.log(
        `  ${PRIORITY_COLORS[task.priority](task.priority)} ${task.id} ${task.title}${claim}`,
      );
    }
  }
}

export function taskJson(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    status: task.status,
    filename: task.filename,
    filePath: task.filePath,
    claimedBy: task.claimedBy,
    claimedAt: task.claimedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    tags: task.tags,
    body: task.body,
  };
}
