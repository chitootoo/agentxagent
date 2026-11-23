/**
 * Console deep links keep portable project ids (for example
 * `github.com/chitootoo/agentxagent`) in a single dynamic path segment.
 * Encoding is required because a raw slash would be parsed as a segment
 * separator and make `/projects/[id]` fail to match (404).
 */
export function projectLink(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function taskLink(projectId: string, taskId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;
}
