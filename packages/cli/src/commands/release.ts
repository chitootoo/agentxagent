import { releaseTask } from "@axa/core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../context.js";
import { taskJson } from "../format.js";

export function registerReleaseCommand(program: Command): void {
  program
    .command("release")
    .description("Release a claimed task back to todo")
    .argument("<id>", "task id or filename")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("--json", "print machine-readable JSON")
    .action(async (id: string, options: ProjectOption & { json?: boolean }) => {
      const projectRoot = await resolveProject(options);
      const task = await releaseTask(projectRoot, id);
      if (options.json) {
        console.log(JSON.stringify(taskJson(task), null, 2));
        return;
      }
      console.log(`${pc.green("✓")} Released ${pc.bold(task.id)} back to todo.`);
    });
}
