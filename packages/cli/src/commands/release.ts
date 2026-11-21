import { releaseStaleTasks, releaseTask, STALE_CLAIM_MS } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, parseDuration, resolveProject } from "../context.js";

interface ReleaseOptions extends ProjectOption {
  stale?: boolean;
  olderThan?: string;
}

export function registerReleaseCommand(program: Command): void {
  program
    .command("release")
    .description("Release your claimed task, or stale claims with --stale")
    .argument("[id]", "task id or folder name")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("--stale", "release every task claimed longer than the threshold")
    .option("--older-than <duration>", "stale threshold for --stale (default 7d)")
    .action(async (id: string | undefined, options: ReleaseOptions) => {
      const projectRoot = await resolveProject(options);

      if (options.stale) {
        if (id) {
          throw new Error("Pass either a task id or --stale, not both.");
        }
        const threshold = options.olderThan ? parseDuration(options.olderThan) : STALE_CLAIM_MS;
        const result = await releaseStaleTasks(projectRoot, threshold);
        console.log(
          `${pc.green("✓")} Released ${result.released.length} stale task(s); skipped ${result.skipped}.`,
        );
        for (const task of result.released) {
          console.log(`  ${pc.bold(task.id)} ${task.title}`);
        }
        return;
      }

      if (!id) {
        throw new Error("Pass a task id or use --stale.");
      }
      const task = await releaseTask(projectRoot, id);
      console.log(`${pc.green("✓")} Released ${pc.bold(task.id)} back to todo.`);
    });
}
