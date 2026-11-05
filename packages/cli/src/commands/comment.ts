import { readFile } from "node:fs/promises";
import { AxaError, commentTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../context.js";
import { taskJson } from "../format.js";

interface CommentOptions extends ProjectOption {
  message?: string;
  bodyFile?: string;
  title?: string;
  agent?: string;
  json?: boolean;
}

async function resolveMessage(options: CommentOptions): Promise<string> {
  const message =
    options.message ?? (options.bodyFile ? await readFile(options.bodyFile, "utf8") : "");
  if (!message.trim()) {
    throw new AxaError("INVALID_TASK", "Pass -m <text> or --body-file <path>.");
  }
  return message;
}

export function registerCommentCommand(program: Command): void {
  program
    .command("comment")
    .alias("iterate")
    .description("Append a user requirement; review/done tasks reopen to todo")
    .argument("<id>", "task id or directory name")
    .option("-p, --project <path|id>", "project path or registered id")
    .option("-m, --message <text>", "requirement text")
    .option("--body-file <path>", "read the requirement from a Markdown file")
    .option("--title <title>", "short title used in the conversation filename")
    .option("-a, --agent <name>", "author identity (or set AXA_AGENT)")
    .option("--json", "print machine-readable JSON")
    .action(async (id: string, options: CommentOptions) => {
      const projectRoot = await resolveProject(options);
      const message = await resolveMessage(options);
      const actor = options.agent?.trim() || process.env.AXA_AGENT?.trim() || "human";
      const task = await commentTask(projectRoot, id, message, actor, options.title);
      if (options.json) {
        console.log(JSON.stringify(taskJson(task), null, 2));
        return;
      }
      const entry = task.conversation.at(-1);
      console.log(
        `${pc.green("✓")} Added ${pc.bold(entry?.filename ?? "user message")} to ${pc.bold(task.id)} → ${task.status}`,
      );
      console.log(`  ${pc.dim(entry?.filePath ?? task.filePath)}`);
    });
}
