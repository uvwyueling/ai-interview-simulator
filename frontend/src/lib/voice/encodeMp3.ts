/**
 * webm/opus → MP3 transcode for the high-accuracy transcription pass.
 *
 * ─── Load this module ONLY via dynamic import() ────────────────────────────
 * Same discipline as capture.ts, and for the same reason plus one more: this
 * chunk drags in the MP3 encoder, so a static import would put it in the main
 * bundle and make every browser-only user download an encoder they will never
 * run. Verifiable in the Network panel.
 *
 * ─── Why transcode at all ──────────────────────────────────────────────────
 * The cloud provider accepts wav/pcm/mp3; Chrome's MediaRecorder produces
 * webm/opus. The two sets do not intersect, so this is required, not an
 * optimisation. See asr/limits.ts for why MP3 and not WAV.
 *
 * Zero React on purpose — capture.ts owns the device, useAnswerAudio.ts owns the
 * lifecycle, this only owns the transform.
 */
import {
  ENCODE_YIELD_EVERY_FRAMES,
  MP3_FRAME_SAMPLES,
  MP3_KBPS,
  MP3_SAMPLE_RATE,
} from "@/lib/asr/limits";

export type EncodeFailReason =
  /** No OfflineAudioContext / no encoder — nothing to do but keep the draft. */
  | "unsupported"
  /** The container didn't decode. Corrupt or a codec this browser can't read. */
  | "decode"
  | "encoder"
  /** The caller's signal fired: a discard, or the user pressing 跳过. */
  | "aborted";

export type EncodeResult =
  | { status: "ok"; blob: Blob; bytes: number; encodeMs: number; decodeMs: number }
  | { status: "failed"; reason: EncodeFailReason };

type Lame = {
  Mp3Encoder: new (
    channels: number,
    sampleRate: number,
    kbps: number
  ) => { encodeBuffer(block: Int16Array): Int8Array; flush(): Int8Array };
};

/**
 * Macro-task yield that browsers do NOT clamp.
 *
 * setTimeout(0) is throttled to ~4ms once nested and to ~1s in a background tab
 * — at hundreds of yields per answer that is the difference between free and
 * ruinous. This is the idiom React's own scheduler uses.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

function getOfflineCtor(): typeof OfflineAudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext ??
    null
  );
}

/**
 * Decode and resample in one step.
 *
 * decodeAudioData resamples to the context's own sample rate, so constructing
 * the context AT 16kHz is the whole resampler — no hand-written interpolation.
 * (Verified: a 48kHz recording comes back with sampleRate === 16000.) The length
 * argument is irrelevant because this context only ever decodes, never renders.
 */
async function decodeTo16k(buf: ArrayBuffer): Promise<AudioBuffer | null> {
  const Ctor = getOfflineCtor();
  if (!Ctor) return null;
  try {
    return await new Ctor(1, 1, MP3_SAMPLE_RATE).decodeAudioData(buf);
  } catch {
    return null;
  }
}

export async function encodeMp3(
  blob: Blob,
  opts: { signal: AbortSignal }
): Promise<EncodeResult> {
  if (opts.signal.aborted) return { status: "failed", reason: "aborted" };
  if (!getOfflineCtor()) return { status: "failed", reason: "unsupported" };

  // NOTE: decodeAudioData DETACHES the ArrayBuffer it is given, after which
  // byteLength reads 0. Anything needed from the raw buffer must be read first.
  const raw = await blob.arrayBuffer();

  const t0 = performance.now();
  const audio = await decodeTo16k(raw);
  const decodeMs = performance.now() - t0;
  if (!audio) return { status: "failed", reason: "decode" };
  if (opts.signal.aborted) return { status: "failed", reason: "aborted" };

  let lame: Lame;
  try {
    const mod = (await import("@breezystack/lamejs")) as unknown as
      | Lame
      | { default: Lame };
    lame = "Mp3Encoder" in mod ? mod : mod.default;
    if (typeof lame?.Mp3Encoder !== "function") throw new Error("no Mp3Encoder");
  } catch {
    return { status: "failed", reason: "encoder" };
  }

  const t1 = performance.now();
  try {
    // The channelCount:1 constraint in capture.ts is a REQUEST, not a promise:
    // a decoded buffer really can come back with 2 channels (observed). Downmix
    // per frame rather than in a whole-array pre-pass — at 300s that pre-pass
    // would allocate another 19MB and cost a full extra sweep.
    const channels = audio.numberOfChannels;
    const left = audio.getChannelData(0);
    const right = channels > 1 ? audio.getChannelData(1) : null;
    const total = left.length;

    const encoder = new lame.Mp3Encoder(1, MP3_SAMPLE_RATE, MP3_KBPS);
    const frame = new Int16Array(MP3_FRAME_SAMPLES);
    const parts: Uint8Array[] = [];
    let frames = 0;

    for (let off = 0; off < total; off += MP3_FRAME_SAMPLES) {
      const n = Math.min(MP3_FRAME_SAMPLES, total - off);
      const target = n === MP3_FRAME_SAMPLES ? frame : new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const j = off + i;
        const v = right ? (left[j] + right[j]) / 2 : left[j];
        const s = v < -1 ? -1 : v > 1 ? 1 : v;
        target[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const out = encoder.encodeBuffer(target);
      if (out.length > 0) parts.push(new Uint8Array(out));

      if (++frames % ENCODE_YIELD_EVERY_FRAMES === 0) {
        await yieldToEventLoop();
        // Checked after the yield, which is the only place control can be lost.
        if (opts.signal.aborted) return { status: "failed", reason: "aborted" };
      }
    }

    const tail = encoder.flush();
    if (tail.length > 0) parts.push(new Uint8Array(tail));

    const out = new Blob(parts as BlobPart[], { type: "audio/mpeg" });
    // Drop the chunk references now; the decoded buffer is ~19MB at 300s and the
    // caller may hold this result while a request is in flight.
    parts.length = 0;
    return {
      status: "ok",
      blob: out,
      bytes: out.size,
      encodeMs: performance.now() - t1,
      decodeMs,
    };
  } catch {
    return { status: "failed", reason: "encoder" };
  }
}
