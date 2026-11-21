import { readFile } from "node:fs/promises";
import { AxaError, summarizeTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../context.js";

interface SummaryOptions extends ProjectOption {
  file: string;
  title?: string;
}

export function registerSummaryCommand(program: Command): void {
  program
    .command("summary")
    .alias("report")
    .description("Append this round's agent summary from a Markdown file")
    .argument("<id>", "task id or folder name")
    .option("-p, --project <path|id>", "project path or registered id")
    .requiredOption("--file <path>", "Markdown file with the summary and verification evidence")
    .option(
      "-t, --title <text>",
      "short title showing the core change, used as the filename suffix",
    )
    .action(async (id: string, options: SummaryOptions) => {
      const projectRoot = await resolveProject(options);
      const message = await readFile(options.file, "utf8").catch((cause: unknown) => {
        throw new AxaError("INVALID_TASK", `Cannot read summary file ${options.file}.`, { cause });
      });
      if (!message.trim()) {
        throw new AxaError("INVALID_TASK", `Summary file ${options.file} is empty.`);
      }
      const task = await summarizeTask(projectRoot, id, message, undefined, options.title);
      const entry = task.conversation.at(-1);
      console.log(
        `${pc.green("✓")} Recorded ${pc.bold(entry?.filename ?? "agent summary")} for ${pc.bold(task.id)}`,
      );
      if (entry?.agent) {
        console.log(`  Agent: ${pc.dim(entry.agent)}`);
      }
      console.log(`  ${pc.dim(entry?.filePath ?? task.filePath)}`);
    });
}
