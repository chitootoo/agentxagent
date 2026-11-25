import { scanTasks } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../../context.js";
import { printBoard } from "../../format.js";

export function registerBoardCommand(program: Command): void {
  program
    .command("board")
    .description("Show the task board grouped by state")
    .option("-p, --project <path|id>", "project path or registered id")
    .action(async (options: ProjectOption) => {
      const projectRoot = await resolveProject(options);
      const { tasks, issues } = await scanTasks(projectRoot);
      console.log(pc.bold(projectRoot));
      printBoard(tasks);
      for (const issue of issues) {
        console.error(`${pc.yellow("warning:")} ${issue.filePath}: ${issue.message}`);
      }
    });
}
