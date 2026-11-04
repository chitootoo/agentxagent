import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AxaError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 30_000;

interface LockOptions {
  timeoutMs?: number;
  staleMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const owner = await readFile(join(lockPath, "owner.json"), "utf8");
    const parsed = JSON.parse(owner) as { acquiredAt?: number };
    return typeof parsed.acquiredAt === "number" && Date.now() - parsed.acquiredAt > staleMs;
  } catch {
    return false;
  }
}

export async function withLock<T>(
  lockPath: string,
  task: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const token = randomUUID();
  const startedAt = Date.now();
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(
        join(lockPath, "owner.json"),
        JSON.stringify({ token, pid: process.pid, acquiredAt: Date.now() }),
        "utf8",
      );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    if (await isStale(lockPath, staleMs)) {
      const stalePath = `${lockPath}.stale-${token}`;
      try {
        await rename(lockPath, stalePath);
        await rm(stalePath, { recursive: true, force: true });
        continue;
      } catch {
        // Another process may have cleaned it up first.
      }
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new AxaError(
        "LOCK_TIMEOUT",
        `Timed out waiting for lock ${lockPath}. Another agent may be operating on this project.`,
      );
    }
    await sleep(20 + Math.floor(Math.random() * 30));
  }

  try {
    return await task();
  } finally {
    try {
      const owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as {
        token?: string;
      };
      if (owner.token === token) {
        await rm(lockPath, { recursive: true, force: true });
      }
    } catch {
      // Lock already removed or taken over after a stale timeout.
    }
  }
}

export function projectLockPath(projectRoot: string): string {
  return join(projectRoot, ".axa", ".lock");
}

export function configLockPath(axaHome: string): string {
  return join(axaHome, ".config.lock");
}
