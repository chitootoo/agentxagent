import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAxaHome } from "@contagxt/axa-core";
import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { type ActivityRow, activity } from "./schema";

type ConsoleDatabase = BetterSQLite3Database<Record<string, never>>;

const globalForDb = globalThis as typeof globalThis & {
  __axaConsoleDb?: BetterSQLite3Database<Record<string, never>>;
};

function createDatabase(): ConsoleDatabase {
  const home = getAxaHome();
  mkdirSync(home, { recursive: true });
  const filename = process.env.AXA_CONSOLE_DB ?? join(home, "console.db");
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
  `);
  return drizzle(sqlite);
}

function getDb(): ConsoleDatabase {
  if (!globalForDb.__axaConsoleDb) {
    globalForDb.__axaConsoleDb = createDatabase();
  }
  return globalForDb.__axaConsoleDb;
}

export interface NewActivity {
  projectId: string;
  taskId: string;
  taskTitle: string;
  action: string;
  actor: string;
}

export function recordActivity(entry: NewActivity): void {
  try {
    getDb()
      .insert(activity)
      .values({ ...entry, createdAt: new Date() })
      .run();
  } catch (error) {
    console.error("[axa] Failed to write activity log:", error);
  }
}

export function listActivityRows(projectId: string | undefined, limit: number): ActivityRow[] {
  if (projectId) {
    return getDb()
      .select()
      .from(activity)
      .where(eq(activity.projectId, projectId))
      .orderBy(desc(activity.createdAt))
      .limit(limit)
      .all();
  }
  return getDb().select().from(activity).orderBy(desc(activity.createdAt)).limit(limit).all();
}
