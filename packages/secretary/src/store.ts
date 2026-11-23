import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AxaError, getAxaHome } from "@contagxt/axa-core";
import {
  DEFAULT_SETTINGS,
  type PublicSecretarySettings,
  type SecretaryChatMessage,
  type SecretaryChatState,
  type SecretarySettings,
  type UpdateSecretarySettingsInput,
} from "./types.js";

const SETTINGS_FILE = "secretary.json";
const CHAT_FILE = "secretary-chat.json";

const queues = new Map<string, Promise<unknown>>();

function settingsPath(): string {
  return join(getAxaHome(), SETTINGS_FILE);
}

function chatPath(): string {
  return join(getAxaHome(), CHAT_FILE);
}

/** Serialize read-modify-write cycles per file inside this process. */
async function withQueue<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeSettings(raw: unknown): SecretarySettings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  return {
    version: 1,
    baseUrl: baseUrl || DEFAULT_SETTINGS.baseUrl,
    model: model || DEFAULT_SETTINGS.model,
    ...(typeof raw.apiKey === "string" && raw.apiKey.trim() ? { apiKey: raw.apiKey.trim() } : {}),
    ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
  };
}

export async function readSettings(): Promise<SecretarySettings> {
  try {
    return sanitizeSettings(JSON.parse(await readFile(settingsPath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS };
  }
}

export function toPublicSettings(settings: SecretarySettings): PublicSecretarySettings {
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasApiKey: Boolean(settings.apiKey),
    ...(settings.updatedAt ? { updatedAt: settings.updatedAt } : {}),
  };
}

export async function updateSettings(
  input: UpdateSecretarySettingsInput,
): Promise<SecretarySettings> {
  return withQueue(settingsPath(), async () => {
    const current = await readSettings();
    const next: SecretarySettings = {
      ...current,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl.trim() } : {}),
      ...(input.model !== undefined ? { model: input.model.trim() } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (input.clearApiKey) {
      delete next.apiKey;
    } else if (input.apiKey?.trim()) {
      next.apiKey = input.apiKey.trim();
    }
    if (!next.baseUrl) {
      throw new AxaError("INVALID_TASK", "Secretary base URL cannot be empty.");
    }
    if (!/^https?:\/\//u.test(next.baseUrl)) {
      throw new AxaError("INVALID_TASK", "Secretary base URL must start with http:// or https://.");
    }
    if (!next.model) {
      throw new AxaError("INVALID_TASK", "Secretary model cannot be empty.");
    }
    await writeAtomic(settingsPath(), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}

function sanitizeChatMessage(raw: unknown): SecretaryChatMessage | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.role !== "boss" && raw.role !== "secretary") return undefined;
  if (typeof raw.body !== "string" || !raw.body.trim()) return undefined;
  const status =
    raw.status === "pending" || raw.status === "error" || raw.status === "done"
      ? raw.status
      : "done";
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
    role: raw.role,
    body: raw.body,
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : new Date().toISOString(),
    status,
    ...(typeof raw.taskId === "string" && raw.taskId ? { taskId: raw.taskId } : {}),
    ...(typeof raw.projectId === "string" && raw.projectId ? { projectId: raw.projectId } : {}),
    ...(typeof raw.inReplyTo === "string" && raw.inReplyTo ? { inReplyTo: raw.inReplyTo } : {}),
  };
}

function sanitizeChat(raw: unknown): SecretaryChatState {
  if (!isRecord(raw)) return { version: 1, messages: [] };
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map(sanitizeChatMessage)
        .filter((entry): entry is SecretaryChatMessage => entry !== undefined)
        .slice(-200)
    : [];
  return { version: 1, messages };
}

export async function readChat(): Promise<SecretaryChatState> {
  try {
    return sanitizeChat(JSON.parse(await readFile(chatPath(), "utf8")));
  } catch {
    return { version: 1, messages: [] };
  }
}

export async function writeChat(state: SecretaryChatState): Promise<void> {
  await withQueue(chatPath(), async () => {
    const trimmed: SecretaryChatState = {
      version: 1,
      messages: state.messages.slice(-200),
    };
    await writeAtomic(chatPath(), `${JSON.stringify(trimmed, null, 2)}\n`);
  });
}

export async function mutateChat(
  mutate: (state: SecretaryChatState) => SecretaryChatState | undefined,
): Promise<SecretaryChatState> {
  return withQueue(chatPath(), async () => {
    const current = await readChat();
    const next = mutate(current) ?? current;
    const trimmed: SecretaryChatState = {
      version: 1,
      messages: next.messages.slice(-200),
    };
    await writeAtomic(chatPath(), `${JSON.stringify(trimmed, null, 2)}\n`);
    return trimmed;
  });
}

export function newMessageId(): string {
  return randomUUID();
}
