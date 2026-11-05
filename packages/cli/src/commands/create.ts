import { readFile } from "node:fs/promises";
import type { TaskPriority } from "@contagxt/axa-core";
import { createTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../context.js";
import { taskJson } from "../format.js";

interface CreateOptions extends ProjectOption {
  priority?: string;
  status?: string;
  description?: string;
  bodyFile?: string;
  tags?: string;
  agent?: string;
  json?: boolean;
}

export function registerCreateCommand(program: Command): void {
  program
    .command("create")
    .description("Create a task (backlog by default)")
    .argument("<title>", "task title")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("--priority <priority>", "P0, P1, or P2", "P1")
    .option("--status <status>", "backlog or todo", "backlog")
    .option("-d, --description <text>", "task body / acceptance notes")
    .option("--body-file <path>", "read the task body from a Markdown file")
    .option("--tags <tags>", "comma-separated tags")
    .option("--agent <name>", "attribution for the author")
    .option("--json", "print machine-readable JSON")
    .action(async (title: string, options: CreateOptions) => {
      const projectRoot = await resolveProject(options);
      const bodyFromFile = options.bodyFile ? await readFile(options.bodyFile, "utf8") : undefined;
      const status = options.status === "todo" ? "todo" : "backlog";
      const task = await createTask({
        projectRoot,
        title,
        priority: (options.priority ?? "P1") as TaskPriority,
        status,
        ...(options.description || bodyFromFile
          ? { body: options.description ?? bodyFromFile ?? "" }
          : {}),
        ...(options.tags
          ? {
              tags: options.tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
          : {}),
        ...(options.agent ? { actor: options.agent } : {}),
      });

      if (options.json) {
        console.log(JSON.stringify(taskJson(task), null, 2));
        return;
      }
      console.log(`${pc.green("✓")} Created ${pc.bold(task.filename)} in ${task.status}`);
      console.log(`  ${pc.dim(task.filePath)}`);
    });
}
