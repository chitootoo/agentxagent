import { claimTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../../context.js";
import { taskJson } from "../../format.js";

interface ClaimOptions extends ProjectOption {
  next?: boolean;
  agent: string;
  json?: boolean;
}

export function registerClaimCommand(program: Command): void {
  program
    .command("claim")
    .alias("start")
    .description("Atomically claim a todo task and mint this round's agent id")
    .argument("[id]", "task id or folder name")
    .option("-p, --project <path|id>", "project path or registered id")
    .requiredOption("-a, --agent <platform>", "your agent platform name, e.g. qoder, trae, codex")
    .option("--next", "claim the highest-priority todo task")
    .option("--json", "print machine-readable JSON")
    .action(async (id: string | undefined, options: ClaimOptions) => {
      if (!id && !options.next) {
        throw new Error("Pass a task id or use --next.");
      }
      if (id && options.next) {
        throw new Error("Pass either a task id or --next, not both.");
      }
      const projectRoot = await resolveProject(options);
      const task = await claimTask({
        projectRoot,
        ...(id ? { taskId: id } : { next: true }),
        agentPlatform: options.agent,
      });

      if (options.json) {
        console.log(JSON.stringify(taskJson(task), null, 2));
        return;
      }
      console.log(`${pc.green("✓")} Claimed ${pc.bold(task.id)} ${task.title}`);
      console.log(`  Agent: ${pc.bold(task.claimedBy ?? "unknown")}`);
      console.log(`  File:  ${task.filePath}`);
    });
}
