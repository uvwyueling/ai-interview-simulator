/**
 * The ASR provider contract.
 *
 * Types only — no imports, no I/O — so the route, the factory and each provider
 * agree on a shape without any of them depending on another's implementation.
 * Swapping vendors means adding one file under providers/ and one `case` in
 * provider.ts; nothing above this layer names a vendor.
 */

export type AsrHint = string;

export type AsrInput = {
  audio: ArrayBuffer;
  mimeType: string;
  durationMs: number;
  language: "zh-CN";
  /** Glossary from résumé + JD + the current question — biases proper nouns and code-switched English. */
  hints: AsrHint[];
  /** The Web Speech draft. Some providers accept it as bias; `mock` echoes it back. */
  draft: string;
};

export type AsrProviderClass = "mock" | "cloud";

export type AsrResult = {
  text: string;
  providerClass: AsrProviderClass;
};

export type AsrErrorCode =
  | "auth"
  | "rate_limit"
  | "upstream"
  | "unsupported_media"
  | "timeout"
  | "unknown";

/**
 * Carries a CODE, deliberately not a user-facing message: the route owns the
 * Chinese copy, so a provider's raw wording can never reach a user (红线 3).
 */
export class AsrError extends Error {
  readonly code: AsrErrorCode;
  /** Upstream HTTP status, when there was one. Safe to log — it carries no user content. */
  readonly status?: number;

  constructor(code: AsrErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AsrError";
    this.code = code;
    this.status = status;
  }
}

export interface AsrProvider {
  /** Vendor id, e.g. "mock" | "openai". SERVER-SIDE ONLY — never returned to the client. */
  readonly name: string;
  /** Coarse class that IS safe to expose: tells the client whether a real upgrade is possible. */
  readonly providerClass: AsrProviderClass;
  transcribe(input: AsrInput, signal: AbortSignal): Promise<AsrResult>;
}
