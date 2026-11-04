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

export type ActivityRow = typeof activity.$inferSelect;
