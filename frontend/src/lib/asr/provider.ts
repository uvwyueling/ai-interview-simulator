/**
 * ASR provider selection. Server-side only.
 *
 * Shape borrows from both existing patterns: the lazy module singleton of
 * lib/llmClient.ts (env read inside the factory, so a missing key surfaces as a
 * caught runtime error rather than an import-time crash) and the
 * `isConfigured()` probe of lib/db.ts (so a route can tell "not configured"
 * apart from "failed").
 *
 * Swapping vendors = one file under providers/ plus one `case` below. Nothing
 * above this module names a vendor.
 */
import type { AsrProvider, AsrProviderClass } from "./types";
import { mockProvider } from "./providers/mock";
import { isOpenAiConfigured, openAiProvider } from "./providers/openai";
import { isXfyunConfigured, xfyunProvider } from "./providers/xfyun";

/** Not a secret, so module-top is fine (unlike the API keys, read lazily). */
const PROVIDER_NAME = (process.env.ASR_PROVIDER ?? "").trim().toLowerCase();

let _provider: AsrProvider | null | undefined;

function build(): AsrProvider | null {
  switch (PROVIDER_NAME) {
    case "mock":
      return mockProvider;
    case "openai":
      // Unconfigured is the same as unavailable: better to fall back to
      // browser-only than to promise an upgrade and 500 mid-answer.
      return isOpenAiConfigured() ? openAiProvider : null;
    case "xfyun":
      // The shipping vendor. Same rule as above — missing credentials degrade
      // to browser-only rather than failing mid-answer.
      return isXfyunConfigured() ? xfyunProvider : null;
    default:
      // Unset OR misspelled. Deliberately null rather than a throw — a typo in a
      // production env var should degrade to browser-only, not take down the
      // interview page.
      return null;
  }
}

export function getAsrProvider(): AsrProvider | null {
  if (_provider === undefined) _provider = build();
  return _provider;
}

/** Drives the GET capability probe, so the client can never be told a lie. */
export function isAsrConfigured(): boolean {
  return getAsrProvider() !== null;
}

/**
 * Coarse class that is safe to expose. The vendor NAME must not reach the
 * client until a privacy policy naming it has been published.
 */
export function asrProviderClass(): AsrProviderClass | null {
  return getAsrProvider()?.providerClass ?? null;
}
