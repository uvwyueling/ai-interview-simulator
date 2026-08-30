/**
 * Deterministic post-correction of a cloud transcript, using the résumé/JD
 * glossary as a dictionary of canonical spellings.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 * Measured against the real service (2026-08-27, a 109.7s human recording):
 * the vendor hears code-switched English essentially correctly, but writes it
 * back with the wrong case and the wrong word boundaries — `deep seek`,
 * `CRD t`, `g MV`, `media recorder`, `next点js`. Those are not recognition
 * failures, they are spelling failures, and we already hold the correct
 * spellings: they came out of the user's own résumé and JD.
 *
 * So the same word list serves two very different purposes, and neither is
 * optional: its CHINESE half goes to the vendor as `dhw` hotwords (proven to
 * flip 买点 → 埋点), while its LATIN half is used here. Nothing else in the
 * pipeline reads it.
 *
 * ─── What this deliberately does NOT do ────────────────────────────────────
 * No fuzzy matching. `veral` ← Vercel is phonetically close and exact matching
 * cannot reach it, but a fuzzy matcher can also rewrite words the user got
 * RIGHT — and the entire point of this layer is to stop the product asserting
 * things that were never said. Same reasoning excludes Chinese terms: Chinese
 * has no word boundaries, so matching a two-character term inside running prose
 * would risk corrupting the answer the user is about to submit.
 *
 * Pure function — no I/O, no imports, deterministic. Safe on the server.
 */

/** Characters an ASR sprinkles INSIDE a term: spaces, dots, slashes, dashes,
 *  underscores, and the 点 that a spoken "dot" turns into (`next点js`). */
const CONNECTOR_CLASS = " ./_点-";

/**
 * Below this the risk flips: `ai` would rewrite the `ai` inside any Latin run
 * that happens to normalise to it, and `js` is worse. Three characters is the
 * shortest length where the résumé glossary is specific enough to trust.
 */
const MIN_KEY_LEN = 3;

/** Sanity bound. A legitimate answer never needs anywhere near this many. */
const MAX_CORRECTIONS = 50;

const CJK = /[一-龥]/;

function normalize(s: string): string {
  return s.toLowerCase().replace(new RegExp(`[${CONNECTOR_CLASS}]`, "g"), "");
}

export function correctTranscript(
  text: string,
  hints: string[]
): { text: string; corrections: number } {
  if (!text || hints.length === 0) return { text, corrections: 0 };

  const dict = new Map<string, string>();
  for (const h of hints) {
    if (CJK.test(h)) continue; // the Chinese half belongs to `dhw`, not here
    const key = normalize(h);
    if (key.length < MIN_KEY_LEN) continue;
    // First wins: hints arrive ranked, and extractHints already prefers the
    // form carrying capitals (TypeScript over typescript).
    if (!dict.has(key)) dict.set(key, h);
  }
  if (dict.size === 0) return { text, corrections: 0 };

  /**
   * A "Latin run" is a maximal span of Latin/digits that may contain connectors
   * inside it, and must begin and end on an alphanumeric.
   *
   * Replacement happens ONLY when a WHOLE run matches a dictionary key. That is
   * the safety property: searching for keys *inside* a run would let a short
   * hint fire in the middle of a longer word. It is also sufficient in practice
   * — every error observed in real speech was a complete run, because Chinese
   * text sits on both sides of it (`走deep seek埋点`, `用CRD t做`, `是g MV和`).
   */
  const runRe = new RegExp(
    `[A-Za-z0-9](?:[A-Za-z0-9${CONNECTOR_CLASS}]*[A-Za-z0-9])?`,
    "g"
  );

  let corrections = 0;
  const out = text.replace(runRe, (run) => {
    if (corrections >= MAX_CORRECTIONS) return run;
    const canonical = dict.get(normalize(run));
    if (!canonical || canonical === run) return run;
    corrections++;
    return canonical;
  });

  return { text: out, corrections };
}
