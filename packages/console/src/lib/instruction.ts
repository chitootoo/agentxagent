import type { Task } from "@contagxt/axa-proto";

export function taskExecutionPrompt(task: Pick<Task, "id" | "title">, projectPath: string): string {
  const root = projectPath.replace(/\/+$/u, "");
  return `在项目 ${root} 下阅读 .axa/SKILL.md，执行任务 #${task.id}「${task.title}」。`;
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
