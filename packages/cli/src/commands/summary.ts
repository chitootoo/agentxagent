import { readFile } from "node:fs/promises";
import { AxaError, summarizeTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../context.js";
import { taskJson } from "../format.js";

interface SummaryOptions extends ProjectOption {
  message?: string;
  bodyFile?: string;
  title?: string;
  agent?: string;
  json?: boolean;
}

async function resolveMessage(options: SummaryOptions): Promise<string> {
  const message =
    options.message ?? (options.bodyFile ? await readFile(options.bodyFile, "utf8") : "");
  if (!message.trim()) {
    throw new AxaError("INVALID_TASK", "Pass -m <text> or --body-file <path>.");
  }
  return message;
}

export function registerSummaryCommand(program: Command): void {
  program
    .command("summary")
    .alias("report")
    .description("Append the agent round summary required before review")
    .argument("<id>", "task id or directory name")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("-m, --message <text>", "summary text")
    .option("--body-file <path>", "read the summary from a Markdown file")
    .option("--title <title>", "short title used in the conversation filename")
    .option("-a, --agent <name>", "agent identity (or set AXA_AGENT)")
    .option("--json", "print machine-readable JSON")
    .action(async (id: string, options: SummaryOptions) => {
      const projectRoot = await resolveProject(options);
      const message = await resolveMessage(options);
      const actor = options.agent?.trim() || process.env.AXA_AGENT?.trim() || "agent";
      const task = await summarizeTask(projectRoot, id, message, actor, options.title);
      if (options.json) {
        console.log(JSON.stringify(taskJson(task), null, 2));
        return;
      }
      const entry = task.conversation.at(-1);
      console.log(
        `${pc.green("✓")} Recorded ${pc.bold(entry?.filename ?? "agent summary")} for ${pc.bold(task.id)}`,
      );
      console.log(`  ${pc.dim(entry?.filePath ?? task.filePath)}`);
    });
}
