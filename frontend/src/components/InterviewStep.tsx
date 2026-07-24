"use client";

import { useState, useEffect, useRef } from "react";
import type { Answer, Exchange, Question } from "@/types/interview";
import { useInterview } from "@/context/InterviewContext";
import { track, EVENTS } from "@/lib/analytics";
import { fetchWithTimeout, isTimeoutError } from "@/lib/fetchWithTimeout";

const MAX_FOLLOWUPS = 3;

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
    appendExchange,
    setIsJudging,
    setPendingFollowUp,
    advanceToNext,
    jumpToStep,
  } = useInterview();

  const [speechSupported, setSpeechSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [seconds, setSeconds] = useState(0);
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

  // Derived question
  const mainQ = questions[currentMainIndex];
  const isFollowUp = pendingFollowUpQuestion !== null;
  const followUpDepth = currentExchanges.length; // 0 = answering main Q; 1+ = answering follow-up N

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

  // ── Reset UI when a new question becomes active ──

  useEffect(() => {
    setTranscript("");
    setInterimTranscript("");
    setSeconds(0);
    setRecording(false);
    questionStartRef.current = Date.now();
    thinkingTimeMsRef.current = 0;
    asrCharsRef.current = 0;
  }, [currentMainIndex]);

  // Also reset when a follow-up question arrives (pendingFollowUpQuestion becomes non-null)
  useEffect(() => {
    if (pendingFollowUpQuestion !== null) {
      setTranscript("");
      setInterimTranscript("");
      setSeconds(0);
      setRecording(false);
      questionStartRef.current = Date.now();
      thinkingTimeMsRef.current = 0;
      asrCharsRef.current = 0;
    }
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
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

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
      }
      setInterimTranscript(interimText);
    };

    // Fired when the browser has actually granted mic access and started
    // listening — the ONLY reliable "permission granted" signal. Clicking
    // the button ≠ granted; the user might still be looking at the popup.
    recognition.onstart = () => {
      const shownAt = micPromptAtRef.current;
      track(EVENTS.MIC_PERMISSION_GRANTED, {
        mainIndex: currentMainIndex,
        depth: currentExchanges.length,
        latencyMs: shownAt != null ? Date.now() - shownAt : undefined,
      });
      micPromptAtRef.current = null;
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const err = event.error;
      const denied = err === "not-allowed" || err === "service-not-allowed";
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
      setRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();

    return () => {
      recognitionRef.current = null;
      recognition.stop();
    };
  }, [recording]);

  // ── Handlers ──

  const toggleRec = () => {
    if (!recording && thinkingTimeMsRef.current === 0) {
      thinkingTimeMsRef.current = Date.now() - questionStartRef.current;
    }
    if (recording) {
      setInterimTranscript("");
    } else {
      // About to call recognition.start() (via the effect on `recording`).
      // Anchor the timestamp here so onstart can compute the popup-hesitation
      // latency, and log the request itself so denials/silence are visible.
      micPromptAtRef.current = Date.now();
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
    setSeconds(0);
    setRecording(false);
    questionStartRef.current = Date.now();
    thinkingTimeMsRef.current = 0;
    asrCharsRef.current = 0;
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

  const handleSubmit = async () => {
    const text = (transcript + interimTranscript).trim();
    if (!text || isJudging) return;

    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
    }

    const answer: Answer = {
      questionId: currentQuestion.id,
      transcript: text,
      durationSeconds: seconds,
      thinkingTimeMs: thinkingTimeMsRef.current,
    };
    const exchange: Exchange = { question: currentQuestion, answer };
    const newExchanges = [...currentExchanges, exchange];

    track(EVENTS.ANSWER_SUBMITTED, {
      mainIndex: currentMainIndex,
      isFollowUp,
      depth: followUpDepth,
      durationSec: seconds,
      answerLen: text.replace(/\s/g, "").length, // length only — never the content
      asrChars: asrCharsRef.current, // chars from voice → 转写编辑率 = 1 - asrChars/answerLen
      isDemo,
    });

    // Update context history immediately (for display)
    appendExchange(exchange);
    setPendingFollowUp(null);

    // Reset local UI (effect-based reset fires when pendingFollowUpQuestion changes,
    // but we also reset manually here to avoid any flash)
    setTranscript("");
    setInterimTranscript("");
    setSeconds(0);
    setRecording(false);
    questionStartRef.current = Date.now();
    thinkingTimeMsRef.current = 0;
    asrCharsRef.current = 0;

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
  const wordsPerMin = seconds > 0 ? Math.round((wordCount / seconds) * 60) : 0;
  const thinkRing = Math.min(seconds / 120, 1);

  const isLastMain = currentMainIndex >= questions.length - 1;
  const canSubmit = !!fullText.trim() && !isJudging;

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

                <div className="mt-6 text-[13px] text-slate-500">
                  {!speechSupported ? (
                    <span className="text-amber-600">浏览器不支持语音，请在右侧输入</span>
                  ) : speechError ? (
                    <span className="text-rose-500">{speechError}</span>
                  ) : recording ? (
                    "正在录音 · 再次点击结束"
                  ) : (
                    "点击麦克风开始作答"
                  )}
                </div>

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
                        {fmt(seconds)}
                      </div>
                    </div>
                  </div>
                  <div className="w-px h-10 bg-slate-200" />
                  <div>
                    <div className="text-[11px] text-slate-400 uppercase tracking-wide">进度</div>
                    <div className="text-[18px] font-mono font-medium tabular-nums text-slate-900">
                      {seconds < 15 ? (
                        <span className="text-emerald-600">充足</span>
                      ) : seconds < 90 ? (
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
                onClick={handleSubmit}
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
                {isJudging ? "AI 判断中" : recording ? "实时语音转文字" : "回答内容"}
              </div>
            </div>
            {!recording && !isJudging && (
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
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={
                currentExchanges.length > 0
                  ? "在此输入对追问的回答…"
                  : "点击左侧麦克风开始录音，或直接在此输入回答…"
              }
              className="flex-1 scroll resize-none bg-slate-50/60 rounded-xl p-5 text-[14px] leading-[1.85] text-slate-700 placeholder-slate-300 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/40 transition min-h-[200px] max-h-[360px]"
            />
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
                  {wordsPerMin}
                  <span className="text-[10px] text-slate-400 ml-0.5">字/分</span>
                </div>
              </div>
              <div className="bg-slate-50/60 rounded-lg py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">用时</div>
                <div className="text-[15px] font-mono font-medium tabular-nums text-slate-800">
                  {fmt(seconds)}
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
    </section>
  );
}
