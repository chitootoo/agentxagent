import { randomUUID } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function isProjectId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export function newProjectId(): string {
  return randomUUID();
}
