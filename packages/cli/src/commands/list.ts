import type { TaskPriority, TaskStatus } from "@contagxt/axa-core";
import { scanTasks, TASK_PRIORITIES, TASK_STATUSES } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../context.js";
import { printBoard, printTaskTable, taskJson } from "../format.js";

interface ListOptions extends ProjectOption {
  status?: string;
  priority?: string;
  claimedBy?: string;
  board?: boolean;
  json?: boolean;
}

function parseStatuses(value: string | undefined): TaskStatus[] | undefined {
  if (!value) return undefined;
  const statuses = value.split(",").map((status) => status.trim()) as TaskStatus[];
  const invalid = statuses.filter(
    (status) => !(TASK_STATUSES as readonly string[]).includes(status),
  );
  if (invalid.length > 0) {
    throw new Error(`Unknown status: ${invalid.join(", ")}. Use ${TASK_STATUSES.join(", ")}.`);
  }
  return statuses;
}

function parsePriority(value: string | undefined): TaskPriority | undefined {
  if (!value) return undefined;
  if (!(TASK_PRIORITIES as readonly string[]).includes(value)) {
    throw new Error(`Unknown priority: ${value}. Use ${TASK_PRIORITIES.join(", ")}.`);
  }
  return value as TaskPriority;
}

async function load(options: ListOptions) {
  const projectRoot = await resolveProject(options);
  const statuses = parseStatuses(options.status);
  const priority = parsePriority(options.priority);
  const result = await scanTasks(projectRoot, {
    ...(statuses ? { statuses } : {}),
    ...(priority ? { priority } : {}),
    ...(options.claimedBy ? { claimedBy: options.claimedBy } : {}),
  });
  return { projectRoot, ...result };
}

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .alias("ls")
    .description("List tasks")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("-s, --status <statuses>", "comma-separated backlog,todo,doing,done")
    .option("--priority <priority>", "P0, P1, or P2")
    .option("--claimed-by <agent>", "only tasks claimed by an agent")
    .option("--board", "group tasks by state")
    .option("--json", "print machine-readable JSON")
    .action(async (options: ListOptions) => {
      const { projectRoot, tasks, issues } = await load(options);
      if (options.json) {
        console.log(JSON.stringify(tasks.map(taskJson), null, 2));
        return;
      }
      console.log(`${pc.bold(projectRoot)} ${pc.dim(`(${tasks.length} tasks)`)}`);
      if (options.board) {
        printBoard(tasks);
      } else {
        printTaskTable(tasks);
      }
      for (const issue of issues) {
        console.error(`${pc.yellow("warning:")} ${issue.filePath}: ${issue.message}`);
      }
    });

  program
    .command("board")
    .description("Show the task board grouped by state")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("--json", "print machine-readable JSON")
    .action(async (options: ProjectOption & { json?: boolean }) => {
      const projectRoot = await resolveProject(options);
      const { tasks, issues } = await scanTasks(projectRoot);
      if (options.json) {
        console.log(JSON.stringify(tasks.map(taskJson), null, 2));
        return;
      }
      console.log(pc.bold(projectRoot));
      printBoard(tasks);
      for (const issue of issues) {
        console.error(`${pc.yellow("warning:")} ${issue.filePath}: ${issue.message}`);
      }
    });
}
