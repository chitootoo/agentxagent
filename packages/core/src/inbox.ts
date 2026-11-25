import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./fs-utils.js";
import { getAxaHome } from "./home.js";

export const INBOX_STATES = ["unread", "processing", "processed"] as const;
export type InboxState = (typeof INBOX_STATES)[number];

export interface InboxNoteInput {
  /** Short source label, e.g. `worker` or `recovery`. */
  from: string;
  /** Task this note is about. */
  projectId: string;
  taskId: string;
  /** Human-readable Markdown body. */
  body: string;
  /** Stable key for dedupe; defaults to `${projectId}:${taskId}`. */
  key?: string;
}

export interface InboxNote extends InboxNoteInput {
  id: string;
  state: InboxState;
  filePath: string;
  createdAt: string;
  key: string;
}

function inboxRoot(): string {
  return join(getAxaHome(), "secretary", "inbox");
}

function stateDir(state: InboxState): string {
  return join(inboxRoot(), state);
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 80);
}

function serializeNote(
  note: InboxNoteInput & { id: string; createdAt: string; key: string },
): string {
  return [
    "---",
    `id: ${JSON.stringify(note.id)}`,
    `from: ${JSON.stringify(note.from)}`,
    `project_id: ${JSON.stringify(note.projectId)}`,
    `task_id: ${JSON.stringify(note.taskId)}`,
    `created_at: ${JSON.stringify(note.createdAt)}`,
    `key: ${JSON.stringify(note.key)}`,
    "---",
    "",
    note.body.trim(),
    "",
  ].join("\n");
}

function parseNote(filePath: string, state: InboxState, raw: string): InboxNote | undefined {
  const separator = raw.indexOf("\n---\n");
  if (!raw.startsWith("---\n") || separator < 0) return undefined;
  const frontmatter = raw.slice(4, separator);
  const body = raw.slice(separator + 5);
  const data: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const match = /^([a-z_]+):\s*(.+)$/u.exec(line);
    if (!match) continue;
    try {
      data[match[1] as string] = JSON.parse(match[2] as string) as string;
    } catch {
      data[match[1] as string] = match[2] as string;
    }
  }
  if (!data.id || !data.from || !data.project_id || !data.task_id || !data.created_at) {
    return undefined;
  }
  const key = data.key ?? `${data.project_id}:${data.task_id}`;
  return {
    id: data.id,
    from: data.from,
    projectId: data.project_id,
    taskId: data.task_id,
    createdAt: data.created_at,
    key,
    body,
    state,
    filePath,
  };
}

/**
 * Drop a human-readable note into the secretary's inbox. The filename embeds
 * a timestamp and uuid so writes are append-only and safe to retry.
 */
export async function enqueueInboxNote(input: InboxNoteInput): Promise<InboxNote> {
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/gu, "-")}_${slug(input.taskId)}_${randomUUID().slice(0, 8)}`;
  const note = { ...input, id, createdAt, key: input.key ?? `${input.projectId}:${input.taskId}` };
  const filePath = join(stateDir("unread"), `${id}.md`);
  await writeFileAtomic(filePath, serializeNote(note));
  return { ...note, state: "unread", filePath };
}

export async function listInboxNotes(state: InboxState): Promise<InboxNote[]> {
  let filenames: string[];
  try {
    filenames = (await readdir(stateDir(state))).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const notes: InboxNote[] = [];
  for (const filename of filenames) {
    const filePath = join(stateDir(state), filename);
    try {
      const note = parseNote(filePath, state, await readFile(filePath, "utf8"));
      if (note) notes.push(note);
    } catch {
      // Skip unreadable notes; they remain in place for a later attempt.
    }
  }
  return notes;
}

/** Move a note between inbox states. Returns the new path. */
export async function moveInboxNote(note: InboxNote, to: InboxState): Promise<string> {
  const destination = join(stateDir(to), `${note.id}.md`);
  await mkdir(dirname(destination), { recursive: true });
  await rename(note.filePath, destination);
  return destination;
}

/** Check whether a key already has a note anywhere in the inbox. */
export async function hasInboxNote(key: string): Promise<boolean> {
  const all = await Promise.all(INBOX_STATES.map((state) => listInboxNotes(state)));
  return all.some((notes) => notes.some((note) => note.key === key));
}

/** Discard a corrupted note so it cannot block the queue forever. */
export async function discardInboxNote(note: InboxNote): Promise<void> {
  await rm(note.filePath, { force: true });
}
