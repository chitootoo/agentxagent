import { approveTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../context.js";
import { taskJson } from "../format.js";

export function registerApproveCommand(program: Command): void {
  program
    .command("approve")
    .description("Move a backlog task to todo after human review")
    .argument("<id>", "task id or filename")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("-a, --agent <name>", "reviewer identity")
    .option("--json", "print machine-readable JSON")
    .action(async (id: string, options: ProjectOption & { agent?: string; json?: boolean }) => {
      const projectRoot = await resolveProject(options);
      const actor = options.agent?.trim() || process.env.AXA_AGENT?.trim();
      const task = await approveTask(projectRoot, id, actor);
      if (options.json) {
        console.log(JSON.stringify(taskJson(task), null, 2));
        return;
      }
      console.log(`${pc.green("✓")} Approved ${pc.bold(task.id)} ${task.title}`);
    });
}
