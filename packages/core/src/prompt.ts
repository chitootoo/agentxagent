import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { taskCompletedNote } from "./prompts/index.js";

export type PromptParams = Record<string, string>;

/** Replace `{{key}}` placeholders. Unknown keys are left intact for visibility. */
export function renderPrompt(template: string, params: PromptParams): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu, (match, key: string) =>
    key in params ? (params[key] as string) : match,
  );
}

/** Render the shared task-completed inbox note. */
export function renderTaskCompletedNote(params: {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  projectId: string;
}): string {
  return renderPrompt(taskCompletedNote, {
    task_id: params.taskId,
    task_title: params.taskTitle,
    task_status: params.taskStatus,
    project_id: params.projectId,
  }).trim();
}

/**
 * Persist a fully-rendered prompt under the project's untracked `.prompts/`
 * directory so prompts can be inspected and debugged after a run.
 * Set `AXA_PROMPT_ROOT` to redirect the output elsewhere (defaults to cwd).
 */
export async function savePrompt(
  scope: string,
  name: string,
  content: string,
): Promise<string | undefined> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]/gu, "_");
    const root = process.env.AXA_PROMPT_ROOT ?? process.cwd();
    const path = join(root, ".prompts", safe(scope), `${timestamp}_${safe(name)}.md`);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content, "utf8");
    return path;
  } catch {
    return undefined;
  }
}
