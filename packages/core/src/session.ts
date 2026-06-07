/**
 * pi-esr: Shared session state
 *
 * Keeps the current session identifier so memory tools can
 * auto-inject it as a tag without creating circular imports
 * between index.ts and memory/tools.ts.
 */

let currentSessionId: string | null = null;

export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

export function setCurrentSessionId(id: string | null): void {
  currentSessionId = id;
}
