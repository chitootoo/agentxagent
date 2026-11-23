import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const activity = sqliteTable("activity", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  taskId: text("task_id").notNull(),
  taskTitle: text("task_title").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Tracks the source JSONL byte size so this cache can be rebuilt on demand. */
export const activityMeta = sqliteTable("activity_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type ActivityRow = typeof activity.$inferSelect;
