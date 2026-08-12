/**
 * Levenshtein distance for transcription metrics.
 *
 * Runs entirely in the browser and only ever yields NUMBERS — the three text
 * versions (Web Speech draft / cloud result / what the user submitted) never
 * leave the page. See analytics.ts rule 2.
 */

/**
 * Strip everything that differs between engines for reasons that aren't accuracy.
 *
 * This is NOT optional. Web Speech zh-CN emits no punctuation; most cloud ASR
 * emits 。，、. A raw distance between them counts every inserted comma as an
 * "upgrade", which would manufacture exactly the business case the metric exists
 * to test. Both metrics are therefore reported twice — raw and normalized — and
 * the normalized one is what decisions are made on.
 */
export function normalizeForDistance(s: string): string {
  return s
    .replace(/\s+/g, "")
    // CJK punctuation + fullwidth forms
    .replace(/[　-〿！-＠［-｀｛-･]/g, "")
    // ASCII punctuation
    .replace(/[!-/:-@[-`{-~]/g, "")
    .toLowerCase();
}

/**
 * Two-row DP. Returns null (rather than a misleading number) when either side
 * exceeds `maxLen` — the caller then omits the field instead of reporting a
 * value computed on truncated input.
 */
export function levenshtein(a: string, b: string, maxLen = 4_000): number | null {
  if (a.length > maxLen || b.length > maxLen) return null;
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Iterate over the shorter string so the row stays small.
  if (a.length > b.length) [a, b] = [b, a];

  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array<number>(a.length + 1);

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    const bc = b.charCodeAt(j - 1);
    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === bc ? 0 : 1;
      curr[i] = Math.min(curr[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

/** Both flavours at once — what every call site actually wants. */
export function distancePair(
  from: string,
  to: string
): { raw: number | null; core: number | null } {
  return {
    raw: levenshtein(from, to),
    core: levenshtein(normalizeForDistance(from), normalizeForDistance(to)),
  };
}
