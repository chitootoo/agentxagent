import { completeTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../../context.js";

export function registerDoneCommand(program: Command): void {
  program
    .command("done")
    .alias("complete")
    .description("Mark a claimed task as done")
    .argument("<id>", "task id or folder name")
    .option("-p, --project <path|id>", "project path or registered id")
    .action(async (id: string, options: ProjectOption) => {
      const projectRoot = await resolveProject(options);
      const task = await completeTask(projectRoot, id);
      if (task.status === "review") {
        console.log(
          `${pc.magenta("⏳")} Finished ${pc.bold(task.id)} ${task.title} → review（等待人类在控制台验收）`,
        );
        return;
      }
      console.log(`${pc.green("✓")} Completed ${pc.bold(task.id)} ${task.title}`);
    });
}
