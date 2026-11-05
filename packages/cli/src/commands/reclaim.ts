import { reclaimStaleTasks } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, parseDuration, resolveProject } from "../context.js";
import { taskJson } from "../format.js";

interface ReclaimOptions extends ProjectOption {
  olderThan: string;
  json?: boolean;
}

export function registerReclaimCommand(program: Command): void {
  program
    .command("reclaim")
    .description("Return tasks with stale claims back to todo")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("--older-than <duration>", "claim age threshold, e.g. 12h or 2d", "24h")
    .option("--json", "print machine-readable JSON")
    .action(async (options: ReclaimOptions) => {
      const projectRoot = await resolveProject(options);
      const result = await reclaimStaleTasks(projectRoot, parseDuration(options.olderThan));
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              reclaimed: result.reclaimed.map(taskJson),
              skipped: result.skipped,
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(
        `${pc.green("✓")} Reclaimed ${result.reclaimed.length} task(s); skipped ${result.skipped}.`,
      );
      for (const task of result.reclaimed) {
        console.log(`  ${pc.bold(task.id)} ${task.title}`);
      }
    });
}
