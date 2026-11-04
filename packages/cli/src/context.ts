import { AxaError, resolveCliProject } from "@axa/core";

export interface ProjectOption {
  project?: string;
}

export async function resolveProject(options: ProjectOption): Promise<string> {
  return resolveCliProject(options.project);
}

export function resolveAgent(value?: string): string {
  const agent = value?.trim() || process.env.AXA_AGENT?.trim();
  if (!agent) {
    throw new AxaError(
      "INVALID_TASK",
      "Pass --agent <name> or set AXA_AGENT so the claim can be attributed.",
    );
  }
  return agent;
}

export function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/u.exec(value.trim());
  if (!match?.[1] || !match[2]) {
    throw new AxaError("INVALID_TASK", `Invalid duration "${value}". Use 30m, 24h, or 7d.`);
  }
  const amount = Number.parseInt(match[1], 10);
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * (multipliers[match[2]] ?? 1);
}
