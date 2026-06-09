/**
 * Lightweight in-memory rate limiter for API routes.
 *
 * ⚠️ Best-effort only. On serverless (Vercel) each instance has its own memory
 * and cold starts reset it, so this is NOT a hard guarantee — it reliably slows
 * a single client/script hammering a warm instance, which is the main abuse
 * vector for a closed beta. For hard limits (public launch), back this with a
 * shared store (Upstash Redis / Vercel KV).
 */

import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export type RateResult = { ok: boolean; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();

  // Opportunistic prune so the map can't grow unbounded.
  if (buckets.size > 5000) {
    buckets.forEach((b, k) => {
      if (now >= b.resetAt) buckets.delete(k);
    });
  }

  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { ok: true, retryAfterSec: 0 };
}
