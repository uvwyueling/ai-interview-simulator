"use client";

/**
 * Owns the audio lifecycle for one answer.
 *
 * ─── Why this exists as a hook and not an effect in InterviewStep ──────────
 * `recording` flips to false on SIX paths, and only ONE of them — the user
 * pressing stop — should send audio anywhere:
 *
 *   user stop          → transcribe            ← the only one
 *   question change    → discard
 *   follow-up arrives  → discard
 *   recognition error  → discard  (×3 sites)
 *   resetAnswer        → discard
 *   submit-while-recording → discard
 *
 * So the recorder cannot hang off `useEffect [recording]`'s cleanup: that
 * cleanup runs on all six. Instead `discard()` is idempotent and safe to call in
 * any phase, which turns each of the five non-transcribing paths into a one-line
 * edit at the site that already sets `recording` false.
 *
 * ─── The generation counter ────────────────────────────────────────────────
 * A late `setTranscript` landing on the NEXT question is the worst bug this
 * feature can produce. Every discard bumps a generation and `finish()` resolves
 * `abandoned` if it moved.
 *
 * That covers aborts this hook knows about. The caller keeps a SECOND, separate
 * guard — it re-checks its own `${questionId}:${segmentIndex}` token against
 * React state, which this hook can't see — so a state transition that never
 * routed through `discard()` still can't produce a cross-question write. Two
 * guards over two different sources of truth, deliberately.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureHandle, CaptureResult } from "@/lib/voice/capture";
import { CLIENT_TRANSCRIBE_TIMEOUT_MS } from "@/lib/asr/limits";
import { fetchWithTimeout, isTimeoutError } from "@/lib/fetchWithTimeout";

export type VoicePhase = "idle" | "recording" | "stopping" | "transcribing";

export type UpgradeFailReason =
  | "capped"
  | "too_short"
  | "unavailable"
  | "no_recorder"
  | "no_mime"
  | "denied"
  | "device_error"
  | "timeout"
  | "network"
  | "http_4xx"
  | "http_5xx"
  | "empty_result"
  | "user_skip"
  | "abandoned";

export type UpgradeOutcome =
  | {
      status: "upgraded";
      text: string;
      latencyMs: number;
      bytes: number;
      durationMs: number;
      providerClass: string;
    }
  | { status: "failed"; reason: UpgradeFailReason; latencyMs: number }
  | { status: "skipped"; reason: "browser_mode" | "too_short" | "unavailable" }
  /** A discard raced us. The caller MUST ignore this and leave the draft alone. */
  | { status: "abandoned" };

export type DiscardReason =
  | "question_change"
  | "followup"
  | "recognition_error"
  | "reset"
  | "submit_while_recording"
  | "unmount";

type FinishArgs = {
  /** Text this segment contributed, i.e. transcript minus what preceded it. */
  draft: string;
  hints: string[];
};

export function useAnswerAudio(opts: { enabled: boolean }) {
  const { enabled } = opts;
  const [phase, setPhase] = useState<VoicePhase>("idle");

  const handleRef = useRef<CaptureHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  /** Set when the capture module reports it can't run, so we stop retrying. */
  const unavailableRef = useRef<UpgradeFailReason | null>(null);

  const releaseAll = useCallback(() => {
    handleRef.current?.abort();
    handleRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const discard = useCallback(
    // `reason` is intentionally unused here: its whole job is to make the six
    // call sites self-documenting (`discard("question_change")` vs `discard()`)
    // and to force the next person to say WHY they're throwing audio away.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (reason: DiscardReason) => {
      generationRef.current += 1;
      releaseAll();
      setPhase("idle");
    },
    [releaseAll]
  );

  /** Belt and braces: unmount must never leave the microphone open. */
  useEffect(() => releaseAll, [releaseAll]);

  const start = useCallback(() => {
    if (!enabled || unavailableRef.current) return;
    const gen = generationRef.current;
    setPhase("recording");
    // Dynamic import: in browser-only mode this chunk is never even fetched.
    void import("@/lib/voice/capture")
      .then(async (m) => {
        const res = await m.startCapture();
        // A discard landed while getUserMedia was resolving.
        if (gen !== generationRef.current) {
          if ("abort" in res) res.abort();
          return;
        }
        if ("status" in res) {
          // Couldn't start at all — remember, so we don't re-prompt every segment.
          unavailableRef.current = res.status === "unavailable" ? res.reason : "unavailable";
          return;
        }
        handleRef.current = res;
      })
      .catch(() => {
        unavailableRef.current = "unavailable";
      });
  }, [enabled]);

  const cancelUpgrade = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const finish = useCallback(
    async ({ draft, hints }: FinishArgs): Promise<UpgradeOutcome> => {
      const gen = generationRef.current;
      const handle = handleRef.current;
      handleRef.current = null;

      if (!enabled) {
        setPhase("idle");
        return { status: "skipped", reason: "browser_mode" };
      }
      if (!handle) {
        setPhase("idle");
        return { status: "skipped", reason: unavailableRef.current ? "unavailable" : "too_short" };
      }

      setPhase("stopping");
      const captured: CaptureResult = await handle.stop();
      if (gen !== generationRef.current) return { status: "abandoned" };

      if (captured.status !== "ok") {
        setPhase("idle");
        if (captured.status === "capped") {
          // RULE A — the audio covers only part of what was said. Substituting a
          // transcript of it would silently delete the tail of the answer.
          return { status: "failed", reason: "capped", latencyMs: 0 };
        }
        if (captured.status === "aborted") return { status: "abandoned" };
        if (captured.status === "empty") return { status: "skipped", reason: "too_short" };
        return { status: "skipped", reason: "unavailable" };
      }

      setPhase("transcribing");
      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = Date.now();

      const form = new FormData();
      form.append("audio", captured.blob, "answer");
      form.append("draft", draft);
      form.append("hints", JSON.stringify(hints));
      form.append("durationMs", String(captured.durationMs));
      form.append("lang", "zh-CN");

      try {
        const res = await fetchWithTimeout(
          "/api/transcribe",
          { method: "POST", body: form, signal: controller.signal },
          CLIENT_TRANSCRIBE_TIMEOUT_MS
        );
        const latencyMs = Date.now() - startedAt;
        if (gen !== generationRef.current) return { status: "abandoned" };
        setPhase("idle");

        if (!res.ok) {
          return {
            status: "failed",
            reason: res.status >= 500 ? "http_5xx" : "http_4xx",
            latencyMs,
          };
        }
        const data = (await res.json()) as {
          text?: string;
          upgraded?: boolean;
          providerClass?: string;
        };
        if (!data.upgraded) return { status: "skipped", reason: "too_short" };
        if (!data.text?.trim()) return { status: "failed", reason: "empty_result", latencyMs };

        return {
          status: "upgraded",
          text: data.text,
          latencyMs,
          bytes: captured.bytes,
          durationMs: captured.durationMs,
          providerClass: data.providerClass ?? "unknown",
        };
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        if (gen !== generationRef.current) return { status: "abandoned" };
        setPhase("idle");
        // This controller is aborted by cancelUpgrade and nothing else — the
        // timeout lives on a separate controller inside fetchWithTimeout. Check
        // it on its own: a user abort and a timeout both surface as AbortError,
        // so isTimeoutError cannot tell them apart and ANDing with it here made
        // every 跳过 report itself as `timeout`.
        if (controller.signal.aborted) {
          return { status: "failed", reason: "user_skip", latencyMs };
        }
        return { status: "failed", reason: isTimeoutError(err) ? "timeout" : "network", latencyMs };
      } finally {
        abortRef.current = null;
      }
    },
    [enabled]
  );

  return { phase, start, finish, discard, cancelUpgrade };
}
