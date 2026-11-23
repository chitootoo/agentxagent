import type { ListProjectsResult } from "@contagxt/axa-core";
import { AxaError, listRegisteredProjects } from "@contagxt/axa-core";

export async function requireProjectSummary(projectId: string): Promise<ListProjectsResult> {
  const projects = await listRegisteredProjects();
  // Old deep links still carry the #026 `git:` prefix; registry ids are now
  // prefix-free, so normalize before looking up.
  const normalizedId = projectId.startsWith("git:") ? projectId.slice("git:".length) : projectId;
  const project = projects.find((candidate) => candidate.id === normalizedId);
  if (!project) {
    throw new AxaError("NOT_FOUND", `Project is not registered: ${projectId}`);
  }
  return project;
}
