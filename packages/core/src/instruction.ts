import { savePrompt } from "./prompt.js";
import { tasksReadme, workerSkill } from "./prompts/index.js";

export async function defaultInstruction(): Promise<string> {
  await savePrompt("worker", "skill", workerSkill);
  return workerSkill;
}

export async function defaultTasksReadme(): Promise<string> {
  await savePrompt("worker", "tasks-readme", tasksReadme);
  return tasksReadme;
}
