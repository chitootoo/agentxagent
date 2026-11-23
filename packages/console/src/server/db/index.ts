import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendActivityEntry,
  getActivityLogSize,
  getAxaHome,
  readActivityEntries,
} from "@contagxt/axa-core";
import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { type ActivityRow, activity, activityMeta } from "./schema";

type ConsoleDatabase = BetterSQLite3Database<Record<string, never>>;

const globalForDb = globalThis as typeof globalThis & {
  __axaConsoleDb?: BetterSQLite3Database<Record<string, never>>;
};

function cachePath(): string {
  const home = getAxaHome();
  const key = createHash("sha256").update(home).digest("hex").slice(0, 12);
  return process.env.AXA_CONSOLE_DB ?? join(tmpdir(), "axa-console", key, "console.db");
}

function createDatabase(): ConsoleDatabase {
  const filename = cachePath();
  mkdirSync(join(filename, ".."), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_title TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activity_project_created_idx
      ON activity (project_id, created_at);
    CREATE TABLE IF NOT EXISTS activity_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return drizzle(sqlite);
}

function getDb(): ConsoleDatabase {
  if (!globalForDb.__axaConsoleDb) {
    globalForDb.__axaConsoleDb = createDatabase();
  }
  return globalForDb.__axaConsoleDb;
}

/** Rebuild the whole cache from the JSONL source whenever it is stale. */
async function syncCacheFromLog(): Promise<void> {
  const db = getDb();
  const size = String(await getActivityLogSize());
  const cached = db.select().from(activityMeta).where(eq(activityMeta.key, "jsonl_size")).get();
  if (cached?.value === size) return;

  const entries = await readActivityEntries();
  db.delete(activity).run();
  for (const entry of entries) {
    db.insert(activity)
      .values({
        id: entry.id,
        projectId: entry.projectId,
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        action: entry.action,
        actor: entry.actor,
        createdAt: new Date(entry.createdAt),
      })
      .run();
  }
  db.insert(activityMeta)
    .values({ key: "jsonl_size", value: size })
    .onConflictDoUpdate({ target: activityMeta.key, set: { value: size } })
    .run();
}

export interface NewActivity {
  projectId: string;
  taskId: string;
  taskTitle: string;
  action: string;
  actor: string;
}

/** Append to the JSONL source of truth; the sqlite cache is refreshed lazily. */
export async function recordActivity(entry: NewActivity): Promise<void> {
  try {
    await appendActivityEntry(entry);
  } catch (error) {
    console.error("[axa] Failed to write activity log:", error);
  }
}

export async function listActivityRows(
  projectId: string | undefined,
  limit: number,
): Promise<ActivityRow[]> {
  await syncCacheFromLog();
  const db = getDb();
  if (projectId) {
    return db
      .select()
      .from(activity)
      .where(eq(activity.projectId, projectId))
      .orderBy(desc(activity.createdAt))
      .limit(limit)
      .all();
  }
  return db.select().from(activity).orderBy(desc(activity.createdAt)).limit(limit).all();
}
