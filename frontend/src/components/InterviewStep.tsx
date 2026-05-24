"use client";

import { useState, useEffect, useRef } from "react";
import type { Answer } from "@/types/interview";
import { useInterview } from "@/context/InterviewContext";

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

export default function InterviewStep() {
  const { questions, currentQuestionIndex, submitAnswer, nextQuestion, goToFeedback } = useInterview();
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [speechError, setSpeechError] = useState("");

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const questionStartRef = useRef(Date.now());
  const thinkingTimeMsRef = useRef(0);

  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [transcript, interimTranscript]);

  // Reset timing counters whenever a new question appears
  useEffect(() => {
    questionStartRef.current = Date.now();
    thinkingTimeMsRef.current = 0;
  }, [currentQuestionIndex]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

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
      if (finalText) setTranscript((prev) => prev + finalText);
      setInterimTranscript(interimText);
    };

    recognition.onerror = () => {
      setSpeechError("语音识别出错，请重试");
      setRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();

    return () => {
      recognitionRef.current = null;
      recognition.stop();
    };
  }, [recording]);

  const toggleRec = () => {
    if (!recording && thinkingTimeMsRef.current === 0) {
      thinkingTimeMsRef.current = Date.now() - questionStartRef.current;
    }
    if (recording) setInterimTranscript("");
    setRecording((r) => !r);
  };

  const resetAnswer = () => {
    setTranscript("");
    setInterimTranscript("");
    setSeconds(0);
    setRecording(false);
    questionStartRef.current = Date.now();
    thinkingTimeMsRef.current = 0;
  };

  const handleNext = () => {
    const answer: Answer = {
      questionId: questions[currentQuestionIndex].id,
      transcript: transcript + interimTranscript,
      durationSeconds: seconds,
      thinkingTimeMs: thinkingTimeMsRef.current,
    };
    submitAnswer(answer);

    if (currentQuestionIndex < questions.length - 1) {
      nextQuestion();
      setTranscript("");
      setInterimTranscript("");
      setSeconds(0);
      setRecording(false);
    } else {
      goToFeedback();
    }
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const q = questions[currentQuestionIndex];
  const thinkRing = Math.min(seconds / 120, 1);
  const wordCount = (transcript + interimTranscript).replace(/\s/g, "").length;
  const wordsPerMin =
    seconds > 0 ? Math.round((wordCount / seconds) * 60) : 0;

  return (
    <section className="fade-up max-w-[1240px] mx-auto px-6 lg:px-10 pt-10 pb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 text-[12px]">
          <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">
            {q.category}
          </span>
          <span className="text-slate-400">
            问题 {currentQuestionIndex + 1} / {questions.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {questions.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all ${i === currentQuestionIndex ? "w-8 bg-indigo-600" : i < currentQuestionIndex ? "w-4 bg-indigo-300" : "w-4 bg-slate-200"}`}
            ></div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6">
        {/* Left: Question + mic */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-8 flex flex-col">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 mb-3">
            面试官
          </div>
          <h2 className="text-[24px] leading-[1.5] font-medium text-slate-900 tracking-tight">
            &ldquo;{q.text}&rdquo;
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
            建议时长 90 - 120 秒
          </div>

          <div className="flex-1 mt-10 flex flex-col items-center justify-center">
            <div className="relative">
              {recording && (
                <>
                  <div className="absolute inset-0 rounded-full bg-indigo-500 pulse-ring"></div>
                  <div
                    className="absolute inset-0 rounded-full bg-indigo-500 pulse-ring"
                    style={{ animationDelay: "0.6s" }}
                  ></div>
                </>
              )}
              <button
                onClick={toggleRec}
                className={`relative w-32 h-32 rounded-full grid place-items-center text-white transition-all ring-soft
                  ${recording ? "bg-rose-500 hover:bg-rose-600" : "bg-indigo-600 hover:bg-indigo-700 hover:scale-105"}`}
              >
                {recording ? (
                  <div className="w-8 h-8 rounded-md bg-white"></div>
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
              {speechError ? (
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

            <div className="mt-6 flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="relative w-10 h-10">
                  <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="#e2e8f0"
                      strokeWidth="3"
                    />
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
                      className={`w-1.5 h-1.5 rounded-full ${recording ? "bg-rose-500 animate-pulse" : "bg-slate-300"}`}
                    ></div>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 uppercase tracking-wide">
                    用时
                  </div>
                  <div className="text-[18px] font-mono font-medium tabular-nums text-slate-900">
                    {fmt(seconds)}
                  </div>
                </div>
              </div>
              <div className="w-px h-10 bg-slate-200"></div>
              <div>
                <div className="text-[11px] text-slate-400 uppercase tracking-wide">
                  进度
                </div>
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
          </div>

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
              onClick={handleNext}
              className="text-[13px] font-medium px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition flex items-center gap-1.5"
            >
              {currentQuestionIndex < questions.length - 1 ? "下一题" : "查看反馈"}
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
        </div>

        {/* Right: Live transcript */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-6 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${recording ? "bg-rose-500 animate-pulse" : "bg-slate-300"}`}
              ></div>
              <div className="text-[13px] font-medium">实时语音转文字</div>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              zh-CN · auto
            </div>
          </div>

          <div
            ref={textRef}
            className="flex-1 scroll overflow-auto bg-slate-50/60 rounded-xl p-5 text-[14px] leading-[1.85] text-slate-700 min-h-[360px] max-h-[460px]"
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

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50/60 rounded-lg py-2.5">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                字数
              </div>
              <div className="text-[15px] font-mono font-medium tabular-nums text-slate-800">
                {wordCount}
              </div>
            </div>
            <div className="bg-slate-50/60 rounded-lg py-2.5">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                语速
              </div>
              <div className="text-[15px] font-mono font-medium tabular-nums text-slate-800">
                {wordsPerMin}
                <span className="text-[10px] text-slate-400 ml-0.5">
                  字/分
                </span>
              </div>
            </div>
            <div className="bg-slate-50/60 rounded-lg py-2.5">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                用时
              </div>
              <div className="text-[15px] font-mono font-medium tabular-nums text-slate-800">
                {fmt(seconds)}
              </div>
            </div>
          </div>

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
              提示：使用 <b>STAR</b> 结构（Situation - Task - Action - Result）
              回答行为面问题。
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
