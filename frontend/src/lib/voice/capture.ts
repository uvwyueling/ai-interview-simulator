/**
 * MediaRecorder wrapper for the high-accuracy transcription pass.
 *
 * ─── Load this module ONLY via dynamic import() ────────────────────────────
 * Browser-only mode must never even fetch this chunk. A structural guarantee —
 * verifiable in the Network panel and in coverage — is a far stronger claim than
 * "we checked a boolean before constructing it", and this is a module about
 * whether the user's audio leaves their machine.
 *
 * Zero React on purpose: the lifecycle lives in hooks/useAnswerAudio.ts, this
 * only owns the device.
 */
import {
  AUDIO_BITS_PER_SECOND,
  MAX_AUDIO_BYTES,
  MAX_SEGMENT_MS,
  MIN_AUDIO_BYTES,
  MIN_AUDIO_MS,
  PREFERRED_MIME_TYPES,
  RECORDER_TIMESLICE_MS,
} from "@/lib/asr/limits";

export type CaptureResult =
  | { status: "ok"; blob: Blob; mimeType: string; durationMs: number; bytes: number }
  /** Hit a hard limit mid-answer. The audio covers only PART of what was said —
   *  callers must fall back to the draft, never substitute a partial transcript. */
  | { status: "capped"; reason: "duration" | "bytes"; durationMs: number; bytes: number }
  | { status: "empty" }
  | { status: "aborted" }
  | { status: "unavailable"; reason: "no_recorder" | "no_mime" | "denied" | "device_error" };

export type CaptureHandle = {
  /** Resolves once the recorder has flushed. Always releases the mic. */
  stop(): Promise<CaptureResult>;
  /** Throw everything away now. Idempotent. Always releases the mic. */
  abort(): void;
  readonly startedAt: number;
};

export function isCaptureSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function pickMimeType(): string | null {
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export async function startCapture(): Promise<CaptureHandle | CaptureResult> {
  if (!isCaptureSupported()) return { status: "unavailable", reason: "no_recorder" };

  const mimeType = pickMimeType();
  if (!mimeType) return { status: "unavailable", reason: "no_mime" };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return {
      status: "unavailable",
      reason: name === "NotAllowedError" || name === "SecurityError" ? "denied" : "device_error",
    };
  }

  let recorder: MediaRecorder;
  try {
    // Explicit bitrate: the browser default for webm/opus is ~128kbps, which puts
    // the longest answer we've measured (257s) at ~4.1MB — against Vercel's 4.5MB
    // body limit. See asr/limits.ts.
    recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return { status: "unavailable", reason: "device_error" };
  }

  let chunks: Blob[] = [];
  let bytes = 0;
  const startedAt = Date.now();
  let capped: "duration" | "bytes" | null = null;
  let aborted = false;
  let settled = false;
  let resolveStop: ((r: CaptureResult) => void) | null = null;
  /**
   * Result computed before anyone was waiting for it.
   *
   * Hitting a cap stops the recorder on its own, so `onstop` runs while the user
   * is still talking and `resolveStop` is null. Without parking the result here
   * it is simply lost, and the later stop() reports "aborted" — the draft would
   * still be safe, but the capped case would emit no telemetry and no
   * explanation to the user, i.e. it would be invisible.
   */
  let pending: CaptureResult | null = null;

  /**
   * The one place the microphone is released. Every exit path routes through it:
   * a leaked second stream leaves Chrome's recording indicator lit after the user
   * has stopped, which — next to copy promising the audio is discarded — is a
   * trust bug, not a resource leak.
   */
  const release = () => {
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* already stopped */
    }
    stream.getTracks().forEach((t) => t.stop());
  };

  const drop = () => {
    chunks = [];
    bytes = 0;
  };

  recorder.ondataavailable = (e: BlobEvent) => {
    if (aborted || !e.data || e.data.size === 0) return;
    chunks.push(e.data);
    bytes += e.data.size;
    if (bytes > MAX_AUDIO_BYTES && !capped) {
      capped = "bytes";
      release();
    }
  };

  recorder.onstop = () => {
    if (settled) return;
    settled = true;
    const durationMs = Date.now() - startedAt;
    const finish = (r: CaptureResult) => {
      drop();
      if (resolveStop) {
        resolveStop(r);
        resolveStop = null;
      } else {
        pending = r; // self-stopped; hand it over when stop() finally arrives
      }
    };
    if (aborted) return finish({ status: "aborted" });
    if (capped) return finish({ status: "capped", reason: capped, durationMs, bytes });
    if (bytes < MIN_AUDIO_BYTES || durationMs < MIN_AUDIO_MS) return finish({ status: "empty" });
    finish({ status: "ok", blob: new Blob(chunks, { type: mimeType }), mimeType, durationMs, bytes });
  };

  recorder.onerror = () => {
    if (settled) return;
    settled = true;
    drop();
    release();
    resolveStop?.({ status: "unavailable", reason: "device_error" });
    resolveStop = null;
  };

  const durationTimer = setTimeout(() => {
    if (!capped && !aborted) {
      capped = "duration";
      release();
    }
  }, MAX_SEGMENT_MS);

  recorder.start(RECORDER_TIMESLICE_MS);

  return {
    startedAt,
    stop() {
      clearTimeout(durationTimer);
      // Parked by a self-stop (a cap was hit while the user kept talking).
      if (pending) {
        const r = pending;
        pending = null;
        return Promise.resolve(r);
      }
      if (settled) return Promise.resolve<CaptureResult>({ status: "aborted" });
      return new Promise<CaptureResult>((resolve) => {
        resolveStop = resolve;
        release();
      });
    },
    abort() {
      clearTimeout(durationTimer);
      aborted = true;
      pending = null; // an abort outranks a parked result
      drop();
      release();
      if (!settled) {
        settled = true;
        resolveStop?.({ status: "aborted" });
        resolveStop = null;
      }
    },
  };
}
