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

/**
 * UUID generator with a fallback. `crypto.randomUUID()` only exists in secure
 * contexts (HTTPS / localhost); on plain HTTP it is undefined and would throw,
 * leaving anonId empty → events rejected by the /api/track schema (min length).
 * The fallback keeps analytics working anywhere.
 */
function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readOrCreate(storage: Storage, key: string): string {
  let id = storage.getItem(key);
  if (!id) {
    id = uuid();
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
