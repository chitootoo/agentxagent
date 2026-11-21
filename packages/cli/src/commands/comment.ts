import { readFile } from "node:fs/promises";
import { AxaError, commentTask } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { type ProjectOption, resolveProject } from "../context.js";

interface CommentOptions extends ProjectOption {
  file: string;
  title?: string;
}

export function registerCommentCommand(program: Command): void {
  program
    .command("comment")
    .alias("iterate")
    .description("Append a human requirement; review/done/archived tasks reopen to todo")
    .argument("<id>", "task id or folder name")
    .option("-p, --project <path|id>", "project path or registered id")
    .requiredOption("--file <path>", "Markdown file with the new requirement")
    .option(
      "-t, --title <text>",
      "short title showing the core requirement, used as the filename suffix",
    )
    .action(async (id: string, options: CommentOptions) => {
      const projectRoot = await resolveProject(options);
      const message = await readFile(options.file, "utf8").catch((cause: unknown) => {
        throw new AxaError("INVALID_TASK", `Cannot read requirement file ${options.file}.`, {
          cause,
        });
      });
      if (!message.trim()) {
        throw new AxaError("INVALID_TASK", `Requirement file ${options.file} is empty.`);
      }
      const task = await commentTask(projectRoot, id, message, "human", options.title);
      const entry = task.conversation.at(-1);
      console.log(
        `${pc.green("✓")} Added ${pc.bold(entry?.filename ?? "user message")} to ${pc.bold(task.id)} → ${task.status}`,
      );
      console.log(`  ${pc.dim(entry?.filePath ?? task.filePath)}`);
    });
}
