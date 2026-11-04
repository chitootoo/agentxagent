import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { AxaError } from "./errors.js";
import type { TaskPriority } from "./types.js";
import { TASK_PRIORITIES } from "./types.js";

export interface ParsedTaskFilename {
  id: string;
  priority: TaskPriority;
  description: string;
}

export interface ParsedDocument {
  data: Record<string, unknown>;
  body: string;
}

const TASK_FILENAME_PATTERN = /^(\d{1,9})_(P[0-2])_(.+)\.md$/u;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function canonicalTaskId(raw: string | number): string {
  const numeric = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new AxaError("INVALID_TASK", `Invalid task id: ${raw}`);
  }
  return String(numeric).padStart(3, "0");
}

export function parseTaskFilename(filename: string): ParsedTaskFilename | undefined {
  const match = TASK_FILENAME_PATTERN.exec(filename);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }
  return {
    id: canonicalTaskId(match[1]),
    priority: match[2] as TaskPriority,
    description: match[3],
  };
}

export function humanizeDescription(description: string): string {
  return description.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKC")
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");

  return slug || "untitled";
}

export function buildTaskFilename(id: string, priority: TaskPriority, title: string): string {
  return `${id}_${priority}_${slugifyTitle(title)}.md`;
}

export function parseTaskDocument(content: string): ParsedDocument {
  const normalized = content.replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n");
  const match = FRONTMATTER_PATTERN.exec(normalized);
  if (!match) {
    return { data: {}, body: normalized.trim() };
  }

  const source = match[1] ?? "";
  let parsed: unknown;
  try {
    parsed = parseYaml(source) ?? {};
  } catch (cause) {
    throw new AxaError("INVALID_TASK", "Task frontmatter is not valid YAML.", { cause });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AxaError("INVALID_TASK", "Task frontmatter must be a YAML mapping.");
  }

  return {
    data: parsed as Record<string, unknown>,
    body: normalized.slice(match[0].length).trim(),
  };
}

export function serializeTaskDocument(data: Record<string, unknown>, body: string): string {
  const clean = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  const yaml = stringifyYaml(clean, { lineWidth: 0 }).trimEnd();
  const content = body.trim();
  return content ? `---\n${yaml}\n---\n\n${content}\n` : `---\n${yaml}\n---\n`;
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function isoDate(value: unknown, fallback: Date): string {
  const raw = stringValue(value);
  if (!raw) {
    return fallback.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}
