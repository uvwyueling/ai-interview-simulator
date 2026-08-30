"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { Answer, Exchange, Question } from "@/types/interview";
import { useInterview } from "@/context/InterviewContext";
import { track, EVENTS } from "@/lib/analytics";
import { fetchWithTimeout, isTimeoutError } from "@/lib/fetchWithTimeout";
import VoiceModeDialog from "./VoiceModeDialog";
import { DEFAULT_VOICE_MODE, readVoiceMode, writeVoiceMode, type VoiceMode } from "@/lib/voiceMode";
import { getAsrCapability } from "@/lib/asrCapability";
import { useAnswerAudio, type DiscardReason } from "@/hooks/useAnswerAudio";
import { extractHints } from "@/lib/asr/hints";
import { distancePair } from "@/lib/textDistance";
import {
  MIN_CLOUD_DRAFT_RATIO,
  RATIO_GUARD_MIN_DRAFT_LEN,
  SETTLE_MAX_TICKS,
  SETTLE_TICK_MS,
  SPEECH_END_CAP_MS,
} from "@/lib/asr/limits";

const MAX_FOLLOWUPS = 3;
// Consecutive `network` errors (no successful transcript in between) tolerated
// before we stop auto-restarting and surface an actionable error. Sized to ride
// out transient drops while still bailing on a genuinely dead connection.
const MAX_NETWORK_RETRIES = 5;

// ── Animated wave bars ─────────────────────────────────────────────────────

function WaveBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center gap-1 h-8">
      {Array.from({ length: 13 }, (_, i) => (
        <div
          key={i}
          className={`w-[3px] rounded-full ${active ? "wave-bar bg-indigo-500" : "bg-slate-200"}`}
          style={{
            height: `${active ? 28 : 6}px`,
            animationDelay: `${i * 0.07}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Judging spinner (AI deciding whether to follow up) ─────────────────────

function JudgingOverlay() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 py-10">
      <div className="relative w-16 h-16">
        <svg
          className="w-16 h-16 text-indigo-200"
          viewBox="0 0 36 36"
          fill="none"
        >
          <circle cx="18" cy="18" r="15" stroke="currentColor" strokeWidth="3" />
        </svg>
        <svg
          className="absolute inset-0 w-16 h-16 text-indigo-500 animate-spin"
          viewBox="0 0 36 36"
          fill="none"
        >
          <path
            d="M18 3 a15 15 0 0 1 15 15"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <svg
            viewBox="0 0 24 24"
            className="w-6 h-6 text-indigo-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z" />
          </svg>
        </div>
      </div>
      <div className="text-center">
        <div className="text-[14px] text-slate-700 font-medium">AI 正在分析回答</div>
        <div className="text-[12px] text-slate-400 mt-1">判断是否需要深入追问…</div>
      </div>
    </div>
  );
}

// ── Conversation history item ──────────────────────────────────────────────

function HistoryItem({
  exchange,
  roundLabel,
}: {
  exchange: Exchange;
  roundLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = exchange.answer.transcript;
  const isLong = text.length > 100;

  return (
    <div className="bg-slate-50/80 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
          {roundLabel}
        </span>
        <span className="text-[11px] text-slate-400 truncate flex-1">
          {exchange.question.text}
        </span>
      </div>
      <div
        className={`text-[13px] text-slate-600 leading-relaxed ${
          !expanded && isLong ? "line-clamp-2" : ""
        }`}
      >
        {text || <span className="text-slate-300 italic">（未作答）</span>}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-indigo-500 hover:text-indigo-700 transition"
        >
          {expanded ? "收起" : "展开全文"}
        </button>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function InterviewStep() {
  const {
    questions,
    currentMainIndex,
    currentExchanges,
    isJudging,
    pendingFollowUpQuestion,
    isDemo,
    jd,
    resume,
    ratings,
    setRating,
    appendExchange,
    setIsJudging,
    setPendingFollowUp,
    advanceToNext,
    jumpToStep,
  } = useInterview();

  const [speechSupported, setSpeechSupported] = useState(true);
  // ── Speech mode (v0.14.0) ──
  // Ships dark: until a vendor and its privacy terms are settled, the honest
  // default is the mode that uploads nothing. `null` = never chosen → ask once.
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(DEFAULT_VOICE_MODE);
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [voiceDialogSource, setVoiceDialogSource] = useState<"first_run" | "settings">("first_run");
  const [cloudAvailable, setCloudAvailable] = useState(false);
  /** Non-sticky, unlike speechError — cleared on every new segment and question. */
  const [transcribeNotice, setTranscribeNotice] = useState("");
  const [upgradeStatus, setUpgradeStatus] = useState<"none" | "upgraded" | "failed" | "skipped">("none");
  const [confirmSubmitWhileRecording, setConfirmSubmitWhileRecording] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  /** Voice only — ticks while `recording`. 0 for a typed answer. */
  const [speakingSeconds, setSpeakingSeconds] = useState(0);
  /** Wall clock for the current question. Ticks regardless of how the user answers. */
  const [answerSeconds, setAnswerSeconds] = useState(0);
  const [speechError, setSpeechError] = useState("");

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const questionStartRef = useRef(Date.now());
  const thinkingTimeMsRef = useRef(0);
  // Cumulative chars contributed by speech recognition (final results), used to
  // estimate how much the user edited the transcript: asrChars vs final length.
  const asrCharsRef = useRef(0);
  // Timestamp when we called recognition.start() → onstart. Enables the
  // mic_prompt_shown → mic_permission_granted latency ("how long did they
  // hesitate on the browser's permission popup").
  const micPromptAtRef = useRef<number | null>(null);
  // Chrome ends recognition on its own after a few seconds of silence (even with
  // continuous=true). We silently restart it (see onend), which re-fires onstart.
  // This guard makes mic_permission_granted fire ONCE per user-initiated recording
  // (the real "granted" signal) instead of once per internal restart — otherwise a
  // single answer inflates granted into the dozens. Reset on each fresh mic click
  // and on question change.
  const grantedFiredRef = useRef(false);
  // Web Speech (zh-CN) streams audio to Google's servers; on flaky / China
  // connections it drops with a `network` error every ~1-3 min, then reconnects.
  // We auto-restart on network (transient), but cap CONSECUTIVE failures with no
  // successful transcript in between so a truly-down connection surfaces an
  // actionable error instead of looping. Reset on new transcript / fresh click.
  const networkRetryRef = useRef(0);
  // ── Cloud upgrade bookkeeping (v0.14.0) ──
  /** `transcript` as it stood when THIS segment started recording (Rule B). */
  const preSegmentRef = useRef("");
  /** Full transcript right after a successful upgrade — the baseline for userEditDistance. */
  const upgradedTextRef = useRef<string | null>(null);
  /** Segments recorded for this answer. >1 makes userEditDistance uninterpretable. */
  const segmentCountRef = useRef(0);
  /** Mirrors `transcript` so async code can read the CURRENT value, not a closure. */
  const transcriptRef = useRef("");
  /** Resolved by recognition.onend, so the upgrade can wait for the real flush. */
  const speechEndedRef = useRef<(() => void) | null>(null);

  // Derived question
  const mainQ = questions[currentMainIndex];
  const isFollowUp = pendingFollowUpQuestion !== null;
  const followUpDepth = currentExchanges.length; // 0 = answering main Q; 1+ = answering follow-up N

  // Demo never uploads: it would spend money on fixtures and yield no real
  // metrics. Capability comes from the server, never a build-time flag.
  const audio = useAnswerAudio({ enabled: !isDemo && voiceMode === "cloud" && cloudAvailable });
  const isUpgrading = audio.phase === "stopping" || audio.phase === "transcribing";

  const currentQuestion: Question = isFollowUp
    ? {
        id: `${mainQ.id}_fu${followUpDepth}`,
        text: pendingFollowUpQuestion,
        category: mainQ.category,
        difficulty: "medium",
      }
    : mainQ;

  // ── Detect speech support on mount ──

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    setSpeechSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // ── Speech mode: restore the choice, ask once if there isn't one ──
  //
  // Read in an effect rather than useState's initializer so SSR and the first
  // client render agree. The demo path never asks and never uploads — it would
  // spend money on fixtures and produce no meaningful metrics.
  useEffect(() => {
    if (isDemo) return;
    const stored = readVoiceMode();
    if (stored) setVoiceMode(stored);

    let cancelled = false;
    void getAsrCapability().then((cap) => {
      if (cancelled) return;
      setCloudAvailable(cap.available);
      // A stored "cloud" choice is only honoured while the server can deliver
      // it; otherwise fall back rather than promise an upgrade that won't come.
      if (!cap.available && stored === "cloud") setVoiceMode("browser");
      if (!stored) {
        setVoiceDialogSource("first_run");
        setVoiceDialogOpen(true);
        track(EVENTS.VOICE_MODE_DIALOG_SHOWN, { source: "first_run", cloudAvailable: cap.available });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  // ── Reset UI when a new question becomes active ──

  useEffect(() => {
    setTranscript("");
    setInterimTranscript("");
    setSpeakingSeconds(0);
    setAnswerSeconds(0);
    setRecording(false);
    questionStartRef.current = Date.now();
    thinkingTimeMsRef.current = 0;
    asrCharsRef.current = 0;
    grantedFiredRef.current = false;
    networkRetryRef.current = 0;
    resetUpgradeState("question_change");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMainIndex]);

  // Also reset when a follow-up question arrives (pendingFollowUpQuestion becomes non-null)
  useEffect(() => {
    if (pendingFollowUpQuestion !== null) {
      setTranscript("");
      setInterimTranscript("");
      setSpeakingSeconds(0);
    setAnswerSeconds(0);
      setRecording(false);
      questionStartRef.current = Date.now();
      thinkingTimeMsRef.current = 0;
      asrCharsRef.current = 0;
      grantedFiredRef.current = false;
      networkRetryRef.current = 0;
      resetUpgradeState("followup");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFollowUpQuestion]);

  // ── Auto-scroll live transcript ──

  useEffect(() => {
    if (recording && liveRef.current) {
      liveRef.current.scrollTop = liveRef.current.scrollHeight;
    }
  }, [transcript, interimTranscript, recording]);

  // ── Timer ──

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSpeakingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  /**
   * Wall clock for the question, running whether or not the user is speaking.
   *
   * DERIVED from questionStartRef rather than incremented: a self-incrementing
   * counter drifts whenever the interval is throttled or delayed, and this value
   * is what the UI shows the user as 「用时」.
   *
   * Keyed on currentQuestion.id so it restarts with each question — the ref is
   * already reset at all four reset sites, so this only needs to re-subscribe.
   */
  useEffect(() => {
    setAnswerSeconds(0);
    const tick = () =>
      setAnswerSeconds(Math.floor((Date.now() - questionStartRef.current) / 1000));
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [currentQuestion.id, currentExchanges.length]);

  // ── Speech recognition ──

  useEffect(() => {
    if (!recording) {
      setInterimTranscript("");
      return;
    }

    setSpeechError("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setSpeechError("您的浏览器不支持语音识别，请使用 Chrome");
      setRecording(false);
      return;
    }

    const recognition: SpeechRecognition = new SpeechRecognitionClass();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
        } else {
          interimText += event.results[i][0].transcript;
        }
      }
      if (finalText) {
        setTranscript((prev) => prev + finalText);
        asrCharsRef.current += finalText.replace(/\s/g, "").length;
        // Progress = the connection is (again) healthy → clear the network streak.
        networkRetryRef.current = 0;
      }
      setInterimTranscript(interimText);
    };

    // Fired when the browser has actually granted mic access and started
    // listening. onstart also fires on every INTERNAL restart (see onend), so
    // guard with grantedFiredRef → mic_permission_granted counts real grants
    // (≈1 per answer), not restarts. Clicking the button ≠ granted; the user
    // might still be looking at the popup.
    recognition.onstart = () => {
      if (grantedFiredRef.current) return; // internal restart → not a new grant
      grantedFiredRef.current = true;
      const shownAt = micPromptAtRef.current;
      track(EVENTS.MIC_PERMISSION_GRANTED, {
        mainIndex: currentMainIndex,
        depth: currentExchanges.length,
        latencyMs: shownAt != null ? Date.now() - shownAt : undefined,
      });
      micPromptAtRef.current = null;
    };

    // Chrome ends recognition on its own after a few seconds of silence, even
    // with continuous=true. Without this, the mic UI stays "on" but nothing is
    // captured and the user must re-click (the root cause of the granted-count
    // blowup). Silently restart while the user still intends to record; the
    // identity check skips restart after an explicit stop / question change.
    recognition.onend = () => {
      // Before the identity check: a pending upgrade needs to know the engine has
      // flushed its last result, and on an explicit stop the ref is already null.
      speechEndedRef.current?.();
      speechEndedRef.current = null;
      if (recognitionRef.current !== recognition) return; // stopped or superseded
      track(EVENTS.MIC_AUTO_RESTART, {
        mainIndex: currentMainIndex,
        depth: currentExchanges.length,
      });
      try {
        recognition.start();
      } catch {
        // start() can throw if called too eagerly — bail out cleanly rather than
        // spin. recording=false triggers the cleanup below.
        recognitionRef.current = null;
        audio.discard("recognition_error"); // not a user stop → the audio is junk
        setRecording(false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const err = event.error;
      // `aborted` fires from our own stop()/teardown — pure self-noise, ignore.
      if (err === "aborted") return;

      const denied = err === "not-allowed" || err === "service-not-allowed";
      // `no-speech` = a natural thinking pause; `network` = Web Speech lost its
      // connection to Google's servers (dominant on China/flaky links — the newly
      // diagnosed cause of the ~10-clicks-per-answer churn). Both are transient:
      // do NOT kill the session, let onend auto-restart. Cap consecutive network
      // failures (no transcript in between) so a truly-dead link surfaces an error
      // instead of looping forever.
      const recoverable = err === "no-speech" || err === "network";

      // Visibility fix: log every error reason (except aborted noise, and denials
      // which have their own event) so we stop flying blind on what kills recording.
      if (!denied) {
        track(EVENTS.MIC_RECOGNITION_ERROR, {
          mainIndex: currentMainIndex,
          depth: currentExchanges.length,
          reason: err,
          recovered: recoverable,
        });
      }

      if (recoverable) {
        if (err === "network") {
          networkRetryRef.current += 1;
          if (networkRetryRef.current > MAX_NETWORK_RETRIES) {
            // Sustained failure — stop looping and tell the user something useful.
            recognitionRef.current = null;
            micPromptAtRef.current = null;
            setSpeechError(
              "网络不稳定导致语音识别中断，请检查网络后重试，或改用键盘输入。"
            );
            audio.discard("recognition_error");
            setRecording(false);
            return;
          }
        }
        // Keep the ref intact → onend (fires right after) auto-restarts silently.
        return;
      }

      // Fatal (denied / audio-capture / …): null the ref FIRST so onend won't
      // restart, then stop cleanly.
      recognitionRef.current = null;
      if (denied) {
        track(EVENTS.MIC_PERMISSION_DENIED, {
          mainIndex: currentMainIndex,
          depth: currentExchanges.length,
          reason: err,
        });
        // Actionable copy — the previous generic "识别出错，请重试" was misleading
        // for permission denials (users would blame the app, not their choice).
        setSpeechError(
          "你还没允许浏览器访问麦克风。请点击地址栏左侧的锁形图标授权后重试，或改用键盘输入。"
        );
      } else {
        setSpeechError("语音识别出错，请重试");
      }
      micPromptAtRef.current = null;
      audio.discard("recognition_error");
      setRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();

    return () => {
      // Null the ref BEFORE stop() so onend sees the mismatch and doesn't restart.
      recognitionRef.current = null;
      recognition.stop();
    };
  }, [recording]);

  // ── Handlers ──

  /** Every abort path funnels here: drop the audio and forget this answer's upgrade. */
  function resetUpgradeState(reason: DiscardReason) {
    audio.discard(reason);
    preSegmentRef.current = "";
    upgradedTextRef.current = null;
    segmentCountRef.current = 0;
    setTranscribeNotice("");
    setUpgradeStatus("none");
  }

  const hints = useMemo(
    () => extractHints(resume, jd, currentQuestion.text),
    [resume, jd, currentQuestion.text]
  );

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  /**
   * Read the transcript only once Web Speech has actually finished with it.
   *
   * `recognition.stop()` does NOT drop pending audio: Chrome finalises it, fires
   * one more `onresult` (which the handler appends to `transcript`), and only
   * then fires `onend`. So the value readable on the stop click is not yet the
   * whole answer.
   *
   * Two wrong versions were shipped past before this one, and both are worth
   * naming because they fail in opposite directions:
   *   1. Appending `interimTranscript` manually at stop — the real final result
   *      then lands on top and the tail appears TWICE (~120 chars duplicated in
   *      a live run).
   *   2. Polling until the value stops changing — the FIRST comparison
   *      trivially succeeds when the finalisation hasn't arrived yet, so it
   *      returns the short draft and the upgrade then overwrites the tail. That
   *      one DELETES the user's words, which is far worse.
   *
   * Timers can't tell "finished" from "hasn't started". `onend` can, so wait for
   * that; the short poll afterwards only covers React's commit lag, by which
   * point the result is already delivered.
   */
  async function settledTranscript(ended: Promise<void>): Promise<string> {
    await ended;
    let last = transcriptRef.current;
    for (let i = 0; i < SETTLE_MAX_TICKS; i++) {
      await new Promise((r) => setTimeout(r, SETTLE_TICK_MS));
      const now = transcriptRef.current;
      if (now === last) return now;
      last = now;
    }
    return transcriptRef.current;
  }

  /**
   * Runs after the user presses stop. Everything here is written so that a
   * failure LEAVES THE DRAFT ALONE — the Web Speech text is already what the
   * user said; a bad upgrade is strictly worse than no upgrade.
   */
  async function runUpgrade(ended: Promise<void>) {
    const base = preSegmentRef.current;
    // Read AFTER Web Speech has finished flushing — see settledTranscript().
    const draftFull = await settledTranscript(ended);
    const segmentDraft = draftFull.slice(base.length);
    const token = `${currentQuestion.id}:${segmentCountRef.current}`;

    track(EVENTS.TRANSCRIBE_STARTED, {
      mainIndex: currentMainIndex,
      depth: currentExchanges.length,
      mode: voiceMode,
      draftLen: segmentDraft.replace(/\s/g, "").length,
      hintCount: hints.length,
      isDemo,
    });

    const outcome = await audio.finish({ draft: segmentDraft, hints });

    // A discard raced us — the answer this belonged to is gone.
    if (outcome.status === "abandoned") return;
    if (token !== `${currentQuestion.id}:${segmentCountRef.current}`) return;

    if (outcome.status === "skipped") {
      setUpgradeStatus("skipped");
      return;
    }

    if (outcome.status === "failed") {
      setUpgradeStatus("failed");
      // RULE A lives here: `capped` means the recording hit a hard limit, so the
      // cloud only ever saw PART of the answer. Falling back is not a
      // degradation, it's the only correct choice.
      setTranscribeNotice(
        outcome.reason === "capped"
          ? "本段较长，已保留浏览器转写结果。"
          : outcome.reason === "user_skip"
            ? ""
            : "优化转写未成功，已保留浏览器转写结果。"
      );
      track(EVENTS.TRANSCRIBE_FAILED, {
        mainIndex: currentMainIndex,
        depth: currentExchanges.length,
        mode: voiceMode,
        reason: outcome.reason,
        transcribeLatencyMs: outcome.latencyMs,
        draftLen: segmentDraft.replace(/\s/g, "").length,
      });
      return;
    }

    // Suspiciously short result — a truncated transcript would wipe most of the
    // answer. Rejecting the odd terse-but-correct one is the cheaper mistake.
    const draftLen = segmentDraft.replace(/\s/g, "").length;
    const cloudLen = outcome.text.replace(/\s/g, "").length;
    if (draftLen > RATIO_GUARD_MIN_DRAFT_LEN && cloudLen < draftLen * MIN_CLOUD_DRAFT_RATIO) {
      setUpgradeStatus("failed");
      setTranscribeNotice("优化转写结果异常，已保留浏览器转写结果。");
      track(EVENTS.TRANSCRIBE_FAILED, {
        mainIndex: currentMainIndex,
        depth: currentExchanges.length,
        mode: voiceMode,
        reason: "suspicious_short",
        transcribeLatencyMs: outcome.latencyMs,
        draftLen,
        cloudLen,
      });
      return;
    }

    // RULE B: replace only THIS segment's tail. A multi-segment answer keeps
    // everything dictated before recording restarted.
    const merged = base + outcome.text;
    setTranscript(merged);
    upgradedTextRef.current = merged;
    setUpgradeStatus("upgraded");
    setTranscribeNotice("");

    const d = distancePair(segmentDraft, outcome.text);
    track(EVENTS.TRANSCRIBE_COMPLETED, {
      mainIndex: currentMainIndex,
      depth: currentExchanges.length,
      mode: voiceMode,
      transcribeLatencyMs: outcome.latencyMs,
      durationSec: Math.round(outcome.durationMs / 1000),
      // audioBytes keeps its original meaning (raw captured bytes) so the column
      // stays comparable across the transcode change; uploadBytes is the new
      // number — what actually went over the wire, and what the provider bills.
      audioBytes: outcome.bytes,
      uploadBytes: outcome.uploadBytes,
      encodeMs: outcome.encodeMs,
      // Splits asrUpgradeDistance into vendor gain vs our deterministic pass —
      // only the former justifies paying the vendor.
      corrections: outcome.corrections,
      draftLen,
      cloudLen,
      hintCount: hints.length,
      asrUpgradeDistance: d.raw,
      asrUpgradeCoreDistance: d.core,
      providerClass: outcome.providerClass,
      isDemo,
    });
  }

  /**
   * Thinking time ends at the first sign the user is answering — pressing record
   * OR typing the first character. It used to be set only in toggleRec, so a
   * keyboard-only answer kept thinkingTimeMs at 0 and the feedback prompt read
   * that as 「思考时间不足 3 秒」, i.e. invented a criticism.
   *
   * Idempotent: only the first call in a question wins.
   */
  const markThinkingDone = () => {
    if (thinkingTimeMsRef.current === 0) {
      thinkingTimeMsRef.current = Date.now() - questionStartRef.current;
    }
  };

  const toggleRec = () => {
    if (!recording) markThinkingDone();
    if (recording) {
      // Do NOT commit interimTranscript here. Web Speech finalises it on stop()
      // and the onresult handler appends it itself; doing it manually as well
      // duplicates the tail of the answer. Hand runUpgrade a promise that
      // resolves on onend so it reads the transcript only once it's complete.
      // The cap covers an engine that never reports end at all.
      const ended = new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(t);
          resolve();
        };
        const t = setTimeout(done, SPEECH_END_CAP_MS);
        speechEndedRef.current = done;
      });
      void runUpgrade(ended);
    } else {
      // About to call recognition.start() (via the effect on `recording`).
      // Anchor the timestamp here so onstart can compute the popup-hesitation
      // latency, and log the request itself so denials/silence are visible.
      // Re-arm the granted guard so THIS genuine attempt fires granted once
      // (internal onend-restarts won't); keeps prompt_shown:granted ≈ 1:1.
      grantedFiredRef.current = false;
      networkRetryRef.current = 0; // fresh attempt → clear any prior network streak
      micPromptAtRef.current = Date.now();
      // Anchor Rule B and start capturing alongside Web Speech.
      preSegmentRef.current = transcript;
      segmentCountRef.current += 1;
      setTranscribeNotice("");
      audio.start();
      track(EVENTS.MIC_PROMPT_SHOWN, {
        mainIndex: currentMainIndex,
        depth: currentExchanges.length,
      });
    }
    setRecording((r) => !r);
  };

  const resetAnswer = () => {
    setTranscript("");
    setInterimTranscript("");
    setSpeakingSeconds(0);
    setAnswerSeconds(0);
    setRecording(false);
    questionStartRef.current = Date.now();
    thinkingTimeMsRef.current = 0;
    asrCharsRef.current = 0;
    // Bring this in line with the question-change effect, which always reset
    // these three; resetAnswer silently didn't, so a stale error or retry streak
    // survived 重新作答.
    setSpeechError("");
    grantedFiredRef.current = false;
    networkRetryRef.current = 0;
    resetUpgradeState("reset");
  };

  // Ask the LLM whether to follow up on the given exchanges. Extracted so it can
  // be re-run on mount when a refresh interrupted the judging step (M3 recovery).
  const runFollowUpJudgment = async (exchanges: Exchange[]) => {
    setIsJudging(true);
    const judgeStartedAt = Date.now();
    // B / plan 2a: non-whitespace char count of the most recent answer, used
    // by the follow-up prompt to soften the next question when the candidate
    // is clearly struggling. Threshold 30 matches the prompt's rule.
    const lastAnswerLen = exchanges[exchanges.length - 1].answer.transcript
      .replace(/\s/g, "").length;
    const wasSoftened = lastAnswerLen < 30;
    try {
      // 45s timeout: judgments normally take 3–6s (thinking mode). On timeout we
      // fall into the existing degrade path (advance without a follow-up) instead
      // of spinning on "AI 判断中" forever (2026-06-10 incident).
      const res = await fetchWithTimeout(
        "/api/generate-followup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mainQuestion: mainQ.text,
            conversationThread: exchanges.map((e) => ({
              question: e.question.text,
              answer: e.answer.transcript,
            })),
            jd,
            resume,
            lastAnswerLen,
          }),
        },
        45_000
      );
      const judgeMs = Date.now() - judgeStartedAt;

      if (res.ok) {
        const data = (await res.json()) as {
          shouldFollowUp: boolean;
          followUpQuestion?: string;
        };
        if (data.shouldFollowUp && data.followUpQuestion) {
          track(EVENTS.FOLLOWUP_TRIGGERED, {
            mainIndex: currentMainIndex,
            depth: exchanges.length,
            latencyMs: judgeMs,
            wasSoftened,
            lastAnswerLen,
          });
          setPendingFollowUp(data.followUpQuestion);
        } else {
          advanceToNext(exchanges);
        }
      } else {
        track(EVENTS.FOLLOWUP_DEGRADED, {
          mainIndex: currentMainIndex,
          depth: exchanges.length,
          reason: `http_${res.status}`,
          latencyMs: judgeMs,
        });
        advanceToNext(exchanges);
      }
    } catch (err) {
      track(EVENTS.FOLLOWUP_DEGRADED, {
        mainIndex: currentMainIndex,
        depth: exchanges.length,
        reason: isTimeoutError(err) ? "timeout" : "network",
        latencyMs: Date.now() - judgeStartedAt,
      });
      advanceToNext(exchanges);
    } finally {
      setIsJudging(false);
    }
  };

  // M3 recovery: if a refresh happened while the app was judging a follow-up,
  // the answer is already in currentExchanges but pendingFollowUpQuestion is null
  // and isJudging was reset — a state that is otherwise impossible (answering the
  // main question has empty exchanges; answering a follow-up has a pending one).
  // Resume the judgment instead of leaving the user to re-answer the main question.
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (recoveredRef.current) return;
    recoveredRef.current = true;
    if (
      !isDemo &&
      !isJudging &&
      pendingFollowUpQuestion === null &&
      currentExchanges.length > 0
    ) {
      if (currentExchanges.length > MAX_FOLLOWUPS) {
        advanceToNext(currentExchanges);
      } else {
        runFollowUpJudgment(currentExchanges);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** `skipUpgradeConfirmed` is passed explicitly rather than read from state —
   *  relying on a stale closure to know the user already answered the prompt is
   *  the kind of thing that breaks the next time this function is touched. */
  const handleSubmit = async (skipUpgradeConfirmed = false) => {
    const text = (transcript + interimTranscript).trim();
    if (!text || isJudging) return;
    // Defence in depth behind the disabled button — never submit mid-upgrade,
    // or the answer stored would be the draft the cloud is about to replace.
    if (isUpgrading) return;

    // Tracked locally, not read back from state: setUpgradeStatus below wouldn't
    // be visible to the track() call in this same invocation, so the event would
    // report "none" for exactly the case the tag exists to make visible.
    let effectiveUpgradeStatus = upgradeStatus;

    if (recording) {
      // Submitting while still recording means the cloud pass never happens.
      // Ask once rather than silently handing them a worse transcript.
      if (!skipUpgradeConfirmed && audio.phase === "recording") {
        setConfirmSubmitWhileRecording(true);
        return;
      }
      setConfirmSubmitWhileRecording(false);
      recognitionRef.current?.stop();
      audio.discard("submit_while_recording");
      effectiveUpgradeStatus = "skipped";
      setUpgradeStatus("skipped");
      setRecording(false);
    }

    const answer: Answer = {
      questionId: currentQuestion.id,
      transcript: text,
      answerSeconds,
      speakingSeconds,
      thinkingTimeMs: thinkingTimeMsRef.current,
    };
    const exchange: Exchange = { question: currentQuestion, answer };
    const newExchanges = [...currentExchanges, exchange];

    // How much the user still had to fix AFTER the cloud pass — the number that
    // says whether the upgrade is good enough. Reported only for single-segment
    // answers: in a multi-segment answer, speech dictated after an upgrade would
    // count as "edits" and contaminate exactly this metric. segmentCount always
    // ships so the filter is visible in SQL.
    const singleSegment = segmentCountRef.current === 1 && upgradedTextRef.current !== null;
    const userEdit = singleSegment ? distancePair(upgradedTextRef.current!, text) : null;

    track(EVENTS.ANSWER_SUBMITTED, {
      mainIndex: currentMainIndex,
      isFollowUp,
      depth: followUpDepth,
      durationSec: speakingSeconds,
      answerSec: answerSeconds,
      answerLen: text.replace(/\s/g, "").length, // length only — never the content
      asrChars: asrCharsRef.current, // chars from voice → 转写编辑率 = 1 - asrChars/answerLen
      isDemo,
      voiceMode,
      upgradeStatus: effectiveUpgradeStatus,
      segmentCount: segmentCountRef.current,
      ...(userEdit
        ? {
            userEditDistance: userEdit.raw,
            userEditCoreDistance: userEdit.core,
            userEdited: (userEdit.core ?? 0) > 0,
            postAsrLen: upgradedTextRef.current!.replace(/\s/g, "").length,
          }
        : {}),
    });

    // Update context history immediately (for display)
    appendExchange(exchange);
    setPendingFollowUp(null);

    // Reset local UI (effect-based reset fires when pendingFollowUpQuestion changes,
    // but we also reset manually here to avoid any flash)
    setTranscript("");
    setInterimTranscript("");
    setSpeakingSeconds(0);
    setAnswerSeconds(0);
    setRecording(false);
    questionStartRef.current = Date.now();
    thinkingTimeMsRef.current = 0;
    asrCharsRef.current = 0;
    resetUpgradeState("submit_while_recording");

    // Demo mode or max follow-ups reached → advance directly
    if (isDemo || newExchanges.length > MAX_FOLLOWUPS) {
      advanceToNext(newExchanges);
      return;
    }

    runFollowUpJudgment(newExchanges);
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const fullText = recording ? transcript + interimTranscript : transcript;
  const wordCount = fullText.replace(/\s/g, "").length;
  // Words-per-minute is a SPEAKING measure — meaningless for a typed answer, so
  // it stays on the speaking clock and is only rendered when there was speech.
  const wordsPerMin =
    speakingSeconds > 0 ? Math.round((wordCount / speakingSeconds) * 60) : 0;
  const hasSpoken = speakingSeconds > 0;
  // Everything the user reads as "how long have I been on this question" uses
  // the wall clock, so a keyboard answer no longer shows 00:00 for minutes.
  const thinkRing = Math.min(answerSeconds / 120, 1);

  const isLastMain = currentMainIndex >= questions.length - 1;
  const canSubmit = !!fullText.trim() && !isJudging && !isUpgrading;
  /** One derived boolean drives the textarea, the 「可直接编辑」 badge and canSubmit,
   *  so the three can never disagree about whether the text is settled. */
  const isEditable = !recording && !isJudging && !isUpgrading;
  /** `tr:` namespace — FeedbackStep only ever reads its own `fb:` / `fu:` keys. */
  const transcriptRatingKey = `tr:${currentMainIndex}:${currentExchanges.length}`;

  // ── Label helpers ──

  const roundLabel = (i: number) =>
    i === 0 ? `Q${currentMainIndex + 1} 主问题` : `Q${currentMainIndex + 1}.${i} 追问`;

  const currentRoundLabel = isFollowUp
    ? `Q${currentMainIndex + 1}.${followUpDepth} 追问`
    : `Q${currentMainIndex + 1} 主问题`;

  return (
    <section className="fade-up max-w-[1240px] mx-auto px-6 lg:px-10 pt-10 pb-16">
      {/* Demo data notice */}
      {isDemo && (
        <div className="mb-6 flex items-center justify-between gap-4 px-5 py-3.5 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3">
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 shrink-0 mt-0.5 text-amber-600"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <div>
              <div className="text-[13px] font-semibold text-amber-900">
                示例数据 · 仅供预览
              </div>
              <div className="text-[12px] text-amber-800/80 mt-0.5">
                以上为虚拟技术岗候选人的演示——上传你自己的简历后，题目将完全围绕你的背景生成。想体验真实 AI 面试评测，请返回上传你的简历与 JD。
              </div>
            </div>
          </div>
          <button
            onClick={() => jumpToStep("input")}
            className="shrink-0 text-[12px] font-medium px-3.5 py-1.5 rounded-lg bg-white ring-1 ring-amber-300 text-amber-900 hover:bg-amber-100 transition whitespace-nowrap"
          >
            返回上传 →
          </button>
        </div>
      )}

      {/* Browser compatibility warning */}
      {!speechSupported && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-[13px] text-amber-900">
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4 shrink-0 mt-0.5 text-amber-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="leading-relaxed">
            <span className="font-semibold">当前浏览器不支持语音识别</span>
            （Safari / Firefox 暂未实现 Web Speech API）。
            你仍可在右侧文字框<span className="font-medium">直接键入回答</span>，所有评分功能正常可用。
            如需语音输入，请切换至{" "}
            <a
              href="https://www.google.com/chrome/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium hover:text-amber-700"
            >
              Chrome 浏览器
            </a>
            。
          </p>
        </div>
      )}

      {/* Progress header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 text-[12px]">
          <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">
            {currentQuestion.category}
          </span>
          <span className="text-slate-400">
            主题 {currentMainIndex + 1} / {questions.length}
          </span>
          {isFollowUp && (
            <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-medium flex items-center gap-1">
              <svg
                viewBox="0 0 24 24"
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 14 4 9 9 4" />
                <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
              </svg>
              追问 {followUpDepth}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {questions.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === currentMainIndex
                  ? "w-8 bg-indigo-600"
                  : i < currentMainIndex
                  ? "w-4 bg-indigo-300"
                  : "w-4 bg-slate-200"
              }`}
            />
          ))}
        </div>
      </div>

      {/* First-time onboarding hint — shown only on the very first question */}
      {currentMainIndex === 0 && currentExchanges.length === 0 && !isFollowUp && (
        <div className="mb-6 flex items-start gap-2.5 px-4 py-3 bg-indigo-50/70 rounded-xl text-[13px] text-indigo-900/80 leading-relaxed">
          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 mt-0.5 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span>
            <span className="font-medium">使用方式：</span>点击麦克风开始作答 · AI 会根据你的回答<span className="font-medium">追问</span>（每题最多 3 次）· 停止录音后可在右侧<span className="font-medium">手动修改文字</span>再提交。
            {/* Name the mode here too — nobody should have to read the privacy
                page to find out whether their audio is being uploaded. */}
            {!isDemo && (
              <>
                {" "}当前语音方式：
                <span className="font-medium">
                  {voiceMode === "cloud" ? "高准确转写" : "仅浏览器转写"}
                </span>
                。
              </>
            )}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6">
        {/* ── Left: Question + mic (or judging state) ──
             min-w-0 on both columns: grid 1fr = minmax(auto,1fr); without it,
             nowrap content (truncate) in the history panel inflates the column's
             min-content width and blows the layout apart on wide screens. */}
        <div className="min-w-0 bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-8 flex flex-col">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 mb-1">
            面试官
          </div>

          {/* Current round label */}
          <div className="mb-3">
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                isFollowUp
                  ? "bg-amber-50 text-amber-700"
                  : "bg-indigo-50 text-indigo-700"
              }`}
            >
              {currentRoundLabel}
            </span>
          </div>

          <h2 className="text-[22px] leading-[1.55] font-medium text-slate-900 tracking-tight">
            &ldquo;{currentQuestion.text}&rdquo;
          </h2>
          <div className="mt-2 flex items-center gap-3 text-[12px] text-slate-400">
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {isFollowUp ? "建议时长 45 - 90 秒" : "建议时长 90 - 120 秒"}
          </div>

          <div className="flex-1 mt-8 flex flex-col items-center justify-center">
            {isJudging ? (
              <JudgingOverlay />
            ) : (
              <>
                {/* Mic button */}
                <div className="relative">
                  {recording && (
                    <>
                      <div className="absolute inset-0 rounded-full bg-indigo-500 pulse-ring" />
                      <div
                        className="absolute inset-0 rounded-full bg-indigo-500 pulse-ring"
                        style={{ animationDelay: "0.6s" }}
                      />
                    </>
                  )}
                  <button
                    onClick={speechSupported ? toggleRec : undefined}
                    disabled={!speechSupported}
                    className={`relative w-32 h-32 rounded-full grid place-items-center transition-all ring-soft
                      ${
                        !speechSupported
                          ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                          : recording
                          ? "text-white bg-rose-500 hover:bg-rose-600"
                          : "text-white bg-indigo-600 hover:bg-indigo-700 hover:scale-105"
                      }`}
                  >
                    {!speechSupported ? (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-12 h-12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="2" y1="2" x2="22" y2="22" />
                        <path d="M18.89 13.23A7 7 0 0 0 19 12v-1" />
                        <path d="M5 10v2a7 7 0 0 0 11.32 5.56" />
                        <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                      </svg>
                    ) : recording ? (
                      <div className="w-8 h-8 rounded-md bg-white" />
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-12 h-12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="9" y="3" width="6" height="12" rx="3" />
                        <path d="M5 11a7 7 0 0 0 14 0" />
                        <path d="M12 18v3" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* isUpgrading sits ABOVE speechError deliberately: speechError
                    is sticky (cleared only when recording restarts), so once the
                    recording has ended it is by construction stale, while the
                    machine state is current. Transcribe failures never write to
                    speechError — they use transcribeNotice, so the two error
                    channels can't overwrite each other. */}
                <div className="mt-6 text-[13px] text-slate-500">
                  {!speechSupported ? (
                    <span className="text-amber-600">浏览器不支持语音，请在右侧输入</span>
                  ) : isUpgrading ? (
                    <span className="inline-flex items-center gap-2 text-indigo-600">
                      <span className="w-3 h-3 rounded-full border-2 border-indigo-300 border-t-indigo-600 animate-spin" />
                      {audio.phase === "stopping" ? "正在处理录音…" : "正在优化转写…"}
                      {audio.phase === "transcribing" && (
                        <button
                          onClick={audio.cancelUpgrade}
                          className="text-[12px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
                        >
                          跳过
                        </button>
                      )}
                    </span>
                  ) : speechError ? (
                    <span className="text-rose-500">{speechError}</span>
                  ) : recording ? (
                    "正在录音 · 再次点击结束"
                  ) : (
                    "点击麦克风开始作答"
                  )}
                </div>

                {/* Mode chip — one control that both DISCLOSES the current mode
                    and switches it. A hidden settings panel would be the less
                    honest choice when the setting governs whether audio leaves
                    the device. Hidden in demo, which never uploads. */}
                {!isDemo && (
                  <button
                    onClick={() => {
                      setVoiceDialogSource("settings");
                      setVoiceDialogOpen(true);
                      track(EVENTS.VOICE_MODE_DIALOG_SHOWN, { source: "settings", cloudAvailable });
                    }}
                    disabled={recording || isUpgrading}
                    className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-slate-400 hover:text-indigo-600 disabled:opacity-50 disabled:hover:text-slate-400 transition"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    {voiceMode === "cloud" ? "高准确转写" : "仅浏览器转写"} · 更改
                  </button>
                )}

                <div className="mt-4">
                  <WaveBars active={recording} />
                </div>

                {/* Timer */}
                <div className="mt-6 flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="relative w-10 h-10">
                      <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                        <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                        <circle
                          cx="18"
                          cy="18"
                          r="15"
                          fill="none"
                          stroke="#4f46e5"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeDasharray={`${thinkRing * 94} 94`}
                        />
                      </svg>
                      <div className="absolute inset-0 grid place-items-center">
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${
                            recording ? "bg-rose-500 animate-pulse" : "bg-slate-300"
                          }`}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 uppercase tracking-wide">用时</div>
                      <div className="text-[18px] font-mono font-medium tabular-nums text-slate-900">
                        {fmt(answerSeconds)}
                      </div>
                    </div>
                  </div>
                  <div className="w-px h-10 bg-slate-200" />
                  <div>
                    <div className="text-[11px] text-slate-400 uppercase tracking-wide">进度</div>
                    <div className="text-[18px] font-mono font-medium tabular-nums text-slate-900">
                      {answerSeconds < 15 ? (
                        <span className="text-emerald-600">充足</span>
                      ) : answerSeconds < 90 ? (
                        <span>正常</span>
                      ) : (
                        <span className="text-amber-600">建议收尾</span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Bottom actions */}
          {!isJudging && (
            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={resetAnswer}
                className="text-[13px] text-slate-500 hover:text-slate-900 transition flex items-center gap-1"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 12a9 9 0 1 0 9-9" />
                  <polyline points="3 4 3 12 11 12" />
                </svg>
                重新作答
              </button>
              <button
                // Wrapped, not passed directly: onClick would hand the MouseEvent
                // to skipUpgradeConfirmed, and an event object is truthy — every
                // click would silently bypass the confirm.
                onClick={() => handleSubmit()}
                disabled={!canSubmit}
                className={`text-[13px] font-medium px-4 py-2 rounded-lg transition flex items-center gap-1.5 ${
                  canSubmit
                    ? "bg-slate-900 text-white hover:bg-slate-800"
                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                }`}
              >
                {isDemo
                  ? isLastMain && followUpDepth === currentExchanges.length
                    ? "查看反馈"
                    : "下一题"
                  : "提交回答"}
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* ── Right: Conversation history + current transcript ── */}
        <div className="min-w-0 bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-6 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full transition-colors ${
                  isJudging
                    ? "bg-amber-400 animate-pulse"
                    : recording
                    ? "bg-rose-500 animate-pulse"
                    : transcript
                    ? "bg-emerald-400"
                    : "bg-slate-300"
                }`}
              />
              <div className="text-[13px] font-medium">
                {isJudging
                  ? "AI 判断中"
                  : recording
                    ? "实时语音转文字"
                    : isUpgrading
                      ? "正在优化转写"
                      : "回答内容"}
              </div>
            </div>
            {isUpgrading && (
              <div className="flex items-center gap-2.5 text-[11px] text-indigo-600 font-medium">
                {/* Second 跳过, mirroring the one under the mic. During the wait the
                    user is watching the TEXT, not the mic — the left-hand control
                    sits outside their field of view and goes unfound (reported
                    from a live run). Same affordance in both places is cheaper
                    than hoping they look left. */}
                {audio.phase === "transcribing" && (
                  <button
                    onClick={audio.cancelUpgrade}
                    className="text-[12px] font-normal text-slate-400 hover:text-slate-600 underline underline-offset-2"
                  >
                    跳过
                  </button>
                )}
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
                  优化中
                </span>
              </div>
            )}
            {isEditable && (
              <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                <svg
                  viewBox="0 0 24 24"
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
                </svg>
                可直接编辑
              </div>
            )}
            {recording && (
              <div className="text-[11px] text-slate-400 font-mono">zh-CN · auto</div>
            )}
          </div>

          {/* Conversation history (previous exchanges for this main question) */}
          {currentExchanges.length > 0 && (
            <div className="mb-4 space-y-2">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mb-2">
                本题对话记录
              </div>
              {currentExchanges.map((ex, i) => (
                <HistoryItem key={i} exchange={ex} roundLabel={roundLabel(i)} />
              ))}
              <div className="border-t border-slate-100 pt-3 mt-3">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mb-2">
                  {isJudging ? "分析已提交的回答…" : `当前回答（${currentRoundLabel}）`}
                </div>
              </div>
            </div>
          )}

          {/* Transcript area */}
          {isJudging ? (
            <div className="flex-1 bg-slate-50/60 rounded-xl p-5 flex items-center justify-center min-h-[200px]">
              <div className="text-[13px] text-slate-400 text-center">
                <svg
                  className="w-6 h-6 text-slate-300 mx-auto mb-2 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M12 3a9 9 0 1 0 9 9" />
                </svg>
                正在分析您的回答…
              </div>
            </div>
          ) : recording ? (
            <div
              ref={liveRef}
              className="flex-1 scroll overflow-auto bg-slate-50/60 rounded-xl p-5 text-[14px] leading-[1.85] text-slate-700 min-h-[200px] max-h-[360px]"
            >
              {transcript === "" && interimTranscript === "" && (
                <div className="text-slate-300 text-[13px] flex items-center gap-2 h-full justify-center flex-col">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-8 h-8 text-slate-200"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                  </svg>
                  等待你开始作答…
                </div>
              )}
              {transcript && <span>{transcript}</span>}
              {interimTranscript && (
                <span className="text-indigo-600 bg-indigo-50 rounded px-0.5">
                  {interimTranscript}
                  <span className="caret">|</span>
                </span>
              )}
            </div>
          ) : (
            /* readOnly, NOT disabled, while upgrading: the text stays selectable
               and copyable, focus isn't stolen, and the DOM node is stable so the
               value swap happens in place instead of remounting and jumping the
               scroll position. */
            <textarea
              value={transcript}
              onChange={(e) => {
                markThinkingDone();
                setTranscript(e.target.value);
              }}
              readOnly={isUpgrading}
              aria-busy={isUpgrading}
              placeholder={
                currentExchanges.length > 0
                  ? "在此输入对追问的回答…"
                  : "点击左侧麦克风开始录音，或直接在此输入回答…"
              }
              className={`flex-1 scroll resize-none rounded-xl p-5 text-[14px] leading-[1.85] text-slate-700 placeholder-slate-300 outline-none transition min-h-[200px] max-h-[360px] ${
                isUpgrading
                  ? "bg-slate-100 cursor-default"
                  : "bg-slate-50/60 focus:bg-white focus:ring-2 focus:ring-indigo-500/40"
              }`}
            />
          )}

          {/* Transcribe outcome — a channel of its own, kept physically separate
              from the sticky speechError so neither can clobber the other. */}
          {transcribeNotice && isEditable && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[12px] text-amber-800">
              <span className="flex-1">{transcribeNotice}</span>
              <button
                onClick={() => setTranscribeNotice("")}
                aria-label="关闭提示"
                className="shrink-0 text-amber-500 hover:text-amber-700"
              >
                ✕
              </button>
            </div>
          )}

          {/* Only asked when the cloud ACTUALLY changed something — otherwise
              there is nothing to rate, and 12 prompts an interview is friction.
              Reuses the context ratings map (tr: prefix) for free persistence and
              the existing double-count guard; FeedbackStep only reads fb:/fu:. */}
          {isEditable && upgradeStatus === "upgraded" && !ratings[transcriptRatingKey] && (
            <div className="mt-3 flex items-center gap-3 px-3 py-2 bg-indigo-50/60 rounded-lg">
              <span className="text-[12px] text-slate-600">这次转写准不准？</span>
              {([1, -1] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setRating(transcriptRatingKey, v);
                    track(EVENTS.TRANSCRIPT_RATED, {
                      value: v,
                      mainIndex: currentMainIndex,
                      depth: currentExchanges.length,
                      mode: voiceMode,
                      cloudLen: (upgradedTextRef.current ?? "").replace(/\s/g, "").length,
                      isDemo,
                    });
                  }}
                  className="text-[14px] hover:scale-110 transition"
                  aria-label={v === 1 ? "准确" : "不准确"}
                >
                  {v === 1 ? "👍" : "👎"}
                </button>
              ))}
            </div>
          )}

          {/* Stats */}
          {!isJudging && (
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-50/60 rounded-lg py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">字数</div>
                <div className="text-[15px] font-mono font-medium tabular-nums text-slate-800">
                  {wordCount}
                </div>
              </div>
              <div className="bg-slate-50/60 rounded-lg py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">语速</div>
                <div className="text-[15px] font-mono font-medium tabular-nums text-slate-800">
                  {/* A typed answer has no speaking rate; showing 0 字/分 reads as
                      "you spoke very slowly" rather than "not applicable". */}
                  {hasSpoken ? (
                    <>
                      {wordsPerMin}
                      <span className="text-[10px] text-slate-400 ml-0.5">字/分</span>
                    </>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </div>
              </div>
              <div className="bg-slate-50/60 rounded-lg py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">用时</div>
                <div className="text-[15px] font-mono font-medium tabular-nums text-slate-800">
                  {fmt(answerSeconds)}
                </div>
              </div>
            </div>
          )}

          {/* Tips */}
          {!isJudging && (
            <div className="mt-4 flex items-start gap-2 px-3 py-2.5 bg-indigo-50/60 rounded-lg">
              <svg
                viewBox="0 0 24 24"
                className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <div className="text-[12px] text-indigo-900/70 leading-relaxed">
                {isFollowUp
                  ? "追问时聚焦细节：给出具体数字、技术选型理由，或量化结果。"
                  : "提示：使用 STAR 结构（Situation - Task - Action - Result）回答行为面问题。"}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Submitting mid-recording means the cloud pass never runs. Asking once
          beats silently handing them a worse transcript than the one they were
          about to get; the audio is discarded and the event is tagged `skipped`
          so this sampling bias stays visible in the data. */}
      {confirmSubmitWhileRecording && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setConfirmSubmitWhileRecording(false)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <div className="text-[15px] font-semibold text-slate-900">还在录音中</div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
              直接提交会跳过「高准确转写」，本题使用浏览器的转写结果。
              也可以先结束录音，等几秒拿到更准确的文字再提交。
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmSubmitWhileRecording(false)}
                className="text-[13px] text-slate-500 hover:text-slate-700 px-3 py-2"
              >
                返回继续录音
              </button>
              <button
                onClick={() => {
                  setConfirmSubmitWhileRecording(false);
                  void handleSubmit(true);
                }}
                className="text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 rounded-lg transition"
              >
                直接提交
              </button>
            </div>
          </div>
        </div>
      )}

      {voiceDialogOpen && (
        <VoiceModeDialog
          cloudAvailable={cloudAvailable}
          initialMode={voiceMode}
          source={voiceDialogSource}
          onConfirm={(mode) => {
            const wasDefault = readVoiceMode() === null;
            setVoiceMode(mode);
            writeVoiceMode(mode);
            setVoiceDialogOpen(false);
            track(EVENTS.VOICE_MODE_SELECTED, {
              mode,
              source: voiceDialogSource,
              cloudAvailable,
              wasDefault,
            });
          }}
          // First run requires a choice — there is no dismiss, because the
          // dialog is the disclosure, not a nag.
          onDismiss={
            voiceDialogSource === "settings" ? () => setVoiceDialogOpen(false) : undefined
          }
        />
      )}
    </section>
  );
}
