import { getTask } from "@axa/core";
import type { Command } from "commander";
import { type ProjectOption, resolveProject } from "../context.js";
import { printTask, taskJson } from "../format.js";

export function registerShowCommand(program: Command): void {
  program
    .command("show")
    .description("Show one task and its full Markdown body")
    .argument("<id>", "task id or filename")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("--json", "print machine-readable JSON")
    .action(async (id: string, options: ProjectOption & { json?: boolean }) => {
      const projectRoot = await resolveProject(options);
      const task = await getTask(projectRoot, id);
      if (options.json) {
        console.log(JSON.stringify(taskJson(task), null, 2));
        return;
      }
      printTask(task);
    });
}
