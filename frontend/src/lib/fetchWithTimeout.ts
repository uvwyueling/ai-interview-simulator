/**
 * fetch with a hard client-side timeout.
 *
 * Why: during the 2026-06-10 incident, upstream LLM calls HUNG without ever
 * resolving — the UI spun on "AI 判断中" forever and even our error tracking
 * never fired (a fetch that never settles hits neither .then nor .catch).
 * A timeout turns "infinite spinner" into a clear error + retry path.
 *
 * Uses a manual AbortController (works in every browser that has fetch),
 * not AbortSignal.timeout (Chrome 103+/Safari 16+ only).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** True when the error came from our timeout abort (vs a genuine network error). */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
