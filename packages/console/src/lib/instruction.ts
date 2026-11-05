import type { Task } from "@contagxt/axa-proto";

export function taskExecutionPrompt(task: Pick<Task, "id" | "title">, projectPath: string): string {
  const root = projectPath.replace(/\/+$/u, "");
  return [
    `请阅读 ${root}/.axa/instruction.md，并按照其中的 axa 工作流执行任务 #${task.id}「${task.title}」。`,
    `先运行 \`axa claim ${task.id} --project ${root} --agent <你的名字>\` 领取任务；完成后在任务正文补充实现说明与验证证据，再运行 \`axa done ${task.id} --project ${root} --agent <你的名字>\`。`,
  ].join("\n");
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy path when clipboard permission is denied.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("浏览器拒绝了剪贴板访问，请手动复制执行指令。");
  }
}
