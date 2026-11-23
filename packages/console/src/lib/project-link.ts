/**
 * Console deep links must keep portable project ids (for example
 * `github.com/chitootoo/agentxagent`) in a single dynamic path segment.
 * A raw slash would be parsed as a separator and make `/projects/[id]` 404.
 *
 * Keep these in sync with `@contagxt/axa-core`'s deep-link helpers. This
 * browser-safe copy avoids pulling Node-only core modules into client bundles.
 */
export function projectLink(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function taskLink(projectId: string, taskId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;
}

/**
 * Next.js 16 keeps percent-encoded values in route params (including `%2F`).
 * Decode them before looking up a project; tolerate already-decoded values.
 */
export function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
