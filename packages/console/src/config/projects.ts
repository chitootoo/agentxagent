import type { ListProjectsResult } from "@contagxt/axa-core";
import { AxaError, listRegisteredProjects } from "@contagxt/axa-core";

export async function requireProjectSummary(projectId: string): Promise<ListProjectsResult> {
  const projects = await listRegisteredProjects();
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    throw new AxaError("NOT_FOUND", `Project is not registered: ${projectId}`);
  }
  return project;
}
