import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readChat, readSettings, updateSettings, writeChat } from "./store.js";
import type { SecretaryChatState } from "./types.js";

let workspace: string;
let axaHome: string;
let previousAxaHome: string | undefined;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "axa-secretary-"));
  axaHome = join(workspace, "home");
  previousAxaHome = process.env.AXA_HOME;
  process.env.AXA_HOME = axaHome;
});

afterEach(async () => {
  if (previousAxaHome === undefined) {
    delete process.env.AXA_HOME;
  } else {
    process.env.AXA_HOME = previousAxaHome;
  }
  await rm(workspace, { recursive: true, force: true });
});

describe("secretary storage", () => {
  it("stores settings in the secretary directory", async () => {
    const settings = await updateSettings({
      baseUrl: "https://example.com/v1",
      model: "test-model",
      apiKey: "test-key",
    });

    expect(await readFile(join(axaHome, "secretary", "secretary.json"), "utf8")).toBe(
      `${JSON.stringify(settings, null, 2)}\n`,
    );
    expect(await readSettings()).toEqual(settings);
    await expect(access(join(axaHome, "secretary.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stores chat in the secretary directory", async () => {
    const state: SecretaryChatState = {
      version: 1,
      messages: [
        {
          id: "message-1",
          role: "boss",
          body: "Hello",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "done",
        },
      ],
    };

    await writeChat(state);

    expect(await readFile(join(axaHome, "secretary", "secretary-chat.json"), "utf8")).toBe(
      `${JSON.stringify(state, null, 2)}\n`,
    );
    expect(await readChat()).toEqual(state);
    await expect(access(join(axaHome, "secretary-chat.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
