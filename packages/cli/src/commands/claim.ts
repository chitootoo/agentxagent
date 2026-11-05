import { claimTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveAgent, resolveProject } from "../context.js";
import { taskJson } from "../format.js";

interface ClaimOptions extends ProjectOption {
  agent?: string;
  next?: boolean;
  json?: boolean;
}

export function registerClaimCommand(program: Command): void {
  program
    .command("claim")
    .alias("start")
    .description("Atomically claim a todo task")
    .argument("[id]", "task id or filename")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("--next", "claim the highest-priority todo task")
    .option("-a, --agent <name>", "agent identity (or set AXA_AGENT)")
    .option("--json", "print machine-readable JSON")
    .action(async (id: string | undefined, options: ClaimOptions) => {
      if (!id && !options.next) {
        throw new Error("Pass a task id or use --next.");
      }
      if (id && options.next) {
        throw new Error("Pass either a task id or --next, not both.");
      }
      const projectRoot = await resolveProject(options);
      const agent = resolveAgent(options.agent);
      const task = await claimTask({
        projectRoot,
        ...(id ? { taskId: id } : { next: true }),
        agent,
      });

      if (options.json) {
        console.log(JSON.stringify(taskJson(task), null, 2));
        return;
      }
      console.log(`${pc.green("✓")} Claimed ${pc.bold(task.id)} ${task.title}`);
      console.log(`  Agent: ${pc.bold(agent)}`);
      console.log(`  File:  ${task.filePath}`);
    });
}
