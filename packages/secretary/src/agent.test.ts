import { describe, expect, it } from "vitest";
import { buildModel } from "./agent.js";

const settings = { version: 1 as const, model: "@cf/openai/gpt-oss-120b", apiKey: "test-key" };

function requiresNonNullAssistantContent(baseUrl: string): boolean {
  const compat = buildModel({ ...settings, baseUrl }).compat;
  return Boolean(
    compat && "requiresNonNullAssistantContent" in compat && compat.requiresNonNullAssistantContent,
  );
}

describe("secretary model compatibility", () => {
  it("sends non-null assistant content on Cloudflare Workers AI", () => {
    expect(
      requiresNonNullAssistantContent("https://api.cloudflare.com/client/v4/accounts/abc/ai/v1"),
    ).toBe(true);
  });

  it("leaves plain OpenAI-compatible endpoints untouched", () => {
    expect(requiresNonNullAssistantContent("https://example.com/v1")).toBe(false);
  });

  it("does not treat Cloudflare AI Gateway as Workers AI", () => {
    expect(
      requiresNonNullAssistantContent(
        "https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
      ),
    ).toBe(false);
  });
});
