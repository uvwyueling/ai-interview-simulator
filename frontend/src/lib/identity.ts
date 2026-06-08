/**
 * Anonymous identity for analytics. Pure client-side, no backend.
 *
 * Two distinct IDs, intentionally stored differently:
 *
 *   anonId    → localStorage     persists across visits / tabs / sessions.
 *                                Lets us compute "returning users" & retention.
 *   sessionId → sessionStorage   fresh per browser tab/visit, cleared on close.
 *                                Lets us compute per-visit funnels.
 *
 * Combining the two gives an approximation of cross-session behaviour without
 * any account system. Limitations: clearing storage, switching browser, or a
 * different device all yield a new anonId — so retention is UNDER-counted. Good
 * enough for an experiment-stage product.
 */

const ANON_KEY = "echo_anon_id";
const SESSION_KEY = "echo_session_id";

function readOrCreate(storage: Storage, key: string): string {
  let id = storage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    storage.setItem(key, id);
  }
  return id;
}

export function getAnonId(): string {
  if (typeof window === "undefined") return ""; // SSR guard
  try {
    return readOrCreate(window.localStorage, ANON_KEY);
  } catch {
    return ""; // private mode / storage disabled
  }
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    return readOrCreate(window.sessionStorage, SESSION_KEY);
  } catch {
    return "";
  }
}
