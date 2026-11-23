import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getAxaHome } from "./config.js";

export interface ActivityEntryInput {
  projectId: string;
  taskId: string;
  taskTitle: string;
  action: string;
  actor: string;
  /** ISO timestamp. Defaults to now when omitted. */
  createdAt?: string;
}

export interface ActivityEntry extends ActivityEntryInput {
  /** 1-based JSONL line number, assigned on read. */
  id: number;
  createdAt: string;
}

export function getActivityLogPath(): string {
  return join(getAxaHome(), "activity.jsonl");
}

/** Append one human-readable JSON line. This file is the source of truth. */
export async function appendActivityEntry(input: ActivityEntryInput): Promise<void> {
  const home = getAxaHome();
  await mkdir(home, { recursive: true });
  const entry = { ...input, createdAt: input.createdAt ?? new Date().toISOString() };
  await appendFile(getActivityLogPath(), `${JSON.stringify(entry)}\n`, "utf8");
}

/** Read all entries in insertion order; malformed lines are skipped. */
export async function readActivityEntries(): Promise<ActivityEntry[]> {
  let content: string;
  try {
    content = await readFile(getActivityLogPath(), "utf8");
  } catch {
    return [];
  }
  const entries: ActivityEntry[] = [];
  let id = 0;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    id += 1;
    try {
      const parsed = JSON.parse(line) as Partial<ActivityEntryInput>;
      if (
        typeof parsed.projectId !== "string" ||
        typeof parsed.taskId !== "string" ||
        typeof parsed.taskTitle !== "string" ||
        typeof parsed.action !== "string" ||
        typeof parsed.actor !== "string" ||
        typeof parsed.createdAt !== "string"
      ) {
        continue;
      }
      entries.push({
        id,
        projectId: parsed.projectId,
        taskId: parsed.taskId,
        taskTitle: parsed.taskTitle,
        action: parsed.action,
        actor: parsed.actor,
        createdAt: parsed.createdAt,
      });
    } catch {
      // Skip a corrupted line instead of failing the whole log.
    }
  }
  return entries;
}

/** Byte size of the source log; used to detect stale derived caches. */
export async function getActivityLogSize(): Promise<number> {
  try {
    return (await stat(getActivityLogPath())).size;
  } catch {
    return 0;
  }
}
