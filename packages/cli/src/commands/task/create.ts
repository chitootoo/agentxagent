import type { TaskPriority } from "@contagxt/axa-core";
import { createTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../../context.js";

interface CreateOptions extends ProjectOption {
  priority?: string;
  description?: string;
  tags?: string;
  agent?: string;
}

export function registerCreateCommand(program: Command): void {
  program
    .command("create")
    .description("Create a backlog task for human approval")
    .argument("<title>", "task title")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("--priority <priority>", "P0, P1, or P2", "P1")
    .option("-d, --description <text>", "task body / acceptance notes")
    .option("--tags <tags>", "comma-separated tags")
    .option("-a, --agent <platform>", "your agent platform name for attribution")
    .action(async (title: string, options: CreateOptions) => {
      const projectRoot = await resolveProject(options);
      const actor = options.agent?.trim() || "human";
      const task = await createTask({
        projectRoot,
        title,
        priority: (options.priority ?? "P1") as TaskPriority,
        status: "backlog",
        ...(options.description ? { body: options.description } : {}),
        ...(options.tags
          ? {
              tags: options.tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
          : {}),
        ...(actor ? { actor } : {}),
      });

      console.log(`${pc.green("✓")} Created ${pc.bold(`#${task.id}`)} in backlog`);
      console.log(`  ${pc.dim(task.filePath)}`);
    });
}
