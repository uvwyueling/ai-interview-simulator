"use client";

import { useState, useEffect, useMemo } from "react";
import RadarChart from "./RadarChart";
import FeedbackCard from "./FeedbackCard";
import type { Feedback } from "@/types/interview";
import { feedbackToRadarDims } from "@/types/interview";
import { useInterview } from "@/context/InterviewContext";

const MOCK_FEEDBACK: Feedback = {
  overallScore: 80,
  dimensions: {
    communication: 82,
    technicalDepth: 76,
    logicalThinking: 88,
    clarity: 71,
    jobFit: 84,
  },
  strengths: [
    "回答采用「背景—动作—结果」三段式，听众容易跟上。",
    "提到了具体的量化指标，可信度高。",
    "使用「我主要做了三件事」，体现了主导意识。",
  ],
  improvements: [
    "介绍技术方案时，可以补充更多权衡与取舍的思考。",
    "部分段落语速偏快，建议在关键结论处刻意停顿。",
    "可以在结尾用一句反问与面试官形成双向交流。",
  ],
  modelAnswer:
    "好的，让我从背景说起。在 ByteSpark 实习期间，我负责文档编辑器的性能优化专项。当时首屏加载时长达到 2.8 秒，远超产品要求的 1 秒目标。我主要从三个层面入手：第一，将同步路由改为基于路由的代码分割，减少首包体积约 40%；第二，用 IntersectionObserver 实现富文本块的懒挂载，避免一次性渲染大量 DOM；第三，对协作 OT 算法做批处理，将 60% 的小操作合并成批量提交。最终首屏降到 0.9 秒，达成目标，并在团队季度会上作为最佳实践分享。",
  thinkingTimeFeedback:
    "思考时间节奏良好，说明你在开口前有清晰的组织意识，这是一个很好的习惯。",
};

function Sk({ className = "" }: { className?: string }) {
  return <div className={`bg-slate-200 rounded animate-pulse ${className}`} />;
}

function RadarCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Sk className="h-4 w-20" />
        <div className="flex gap-3">
          <Sk className="h-3 w-16" />
          <Sk className="h-3 w-16" />
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center py-4">
        <RadarChart dims={[]} isLoading />
      </div>
      <div className="grid grid-cols-5 gap-2 pt-2 border-t border-slate-100">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Sk className="h-2.5 w-10" />
            <Sk className="h-4 w-6" />
            <Sk className="h-1 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="lg:col-span-2 bg-white rounded-2xl ring-1 ring-rose-200 p-10 flex flex-col items-center gap-4 text-center">
      <div className="w-10 h-10 rounded-full bg-rose-50 grid place-items-center text-rose-500">
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      </div>
      <div>
        <div className="text-[14px] font-medium text-slate-900 mb-1">反馈生成失败</div>
        <div className="text-[13px] text-slate-500 max-w-xs">{message}</div>
      </div>
      <button
        onClick={onRetry}
        className="text-[13px] font-medium px-5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition flex items-center gap-2"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 12a9 9 0 1 0 9-9" />
          <polyline points="3 4 3 12 11 12" />
        </svg>
        重试此题
      </button>
    </div>
  );
}

type Props = {
  onRestart: () => void;
};

export default function FeedbackStep({ onRestart }: Props) {
  const { completedThreads, resume } = useInterview();
  const isDemo = completedThreads.length === 0;
  const count = isDemo ? 1 : completedThreads.length;

  const [feedbacks, setFeedbacks] = useState<(Feedback | null)[]>(() =>
    new Array(count).fill(null)
  );
  const [loadingStates, setLoadingStates] = useState<boolean[]>(() =>
    new Array(count).fill(!isDemo)
  );
  const [fetchErrors, setFetchErrors] = useState<(string | null)[]>(() =>
    new Array(count).fill(null)
  );
  const [selectedIdx, setSelectedIdx] = useState(0);

  const fetchOne = async (i: number) => {
    setLoadingStates((prev) => {
      const n = [...prev];
      n[i] = true;
      return n;
    });
    setFetchErrors((prev) => {
      const n = [...prev];
      n[i] = null;
      return n;
    });

    const thread = completedThreads[i];
    if (!thread) {
      setFetchErrors((prev) => {
        const n = [...prev];
        n[i] = "找不到对应对话记录";
        return n;
      });
      setLoadingStates((prev) => {
        const n = [...prev];
        n[i] = false;
        return n;
      });
      return;
    }

    // Compute timing from the thread exchanges
    const thinkingTime = thread.exchanges[0]?.answer.thinkingTimeMs ?? 0;
    const speakingTime = thread.exchanges.reduce(
      (sum, e) => sum + e.answer.durationSeconds * 1000,
      0
    );

    try {
      const res = await fetch("/api/generate-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mainQuestion: thread.mainQuestion.text,
          thread: thread.exchanges.map((e) => ({
            question: e.question.text,
            answer: e.answer.transcript || "（未作答）",
          })),
          resume,
          thinkingTime,
          speakingTime,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成反馈失败");
      setFeedbacks((prev) => {
        const n = [...prev];
        n[i] = data as Feedback;
        return n;
      });
    } catch (err) {
      setFetchErrors((prev) => {
        const n = [...prev];
        n[i] = err instanceof Error ? err.message : "生成反馈失败";
        return n;
      });
    } finally {
      setLoadingStates((prev) => {
        const n = [...prev];
        n[i] = false;
        return n;
      });
    }
  };

  useEffect(() => {
    if (isDemo) {
      setFeedbacks([MOCK_FEEDBACK]);
      return;
    }
    // Stagger requests by 1.2 s each to avoid rate limits
    const timers = completedThreads.map((_, i) =>
      setTimeout(() => fetchOne(i), i * 1200)
    );
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentFeedback = feedbacks[selectedIdx];
  const isLoading = loadingStates[selectedIdx];
  const fetchError = fetchErrors[selectedIdx];
  const hasError = !isLoading && !!fetchError && !currentFeedback;

  const radarDims = useMemo(
    () => (!isLoading && currentFeedback ? feedbackToRadarDims(currentFeedback.dimensions) : []),
    [currentFeedback, isLoading]
  );

  const gradeLabel = (score: number) =>
    score >= 85 ? "A" : score >= 75 ? "B+" : score >= 65 ? "B" : "C";

  // Exchange count for selected thread (shows follow-up depth)
  const selectedThread = isDemo ? null : completedThreads[selectedIdx];
  const exchangeCount = selectedThread ? selectedThread.exchanges.length : 0;

  return (
    <section className="fade-up max-w-[1240px] mx-auto px-6 lg:px-10 pt-10 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-indigo-600 mb-2">
            Step 03 / Feedback
          </div>
          <h2 className="text-[30px] leading-tight font-semibold tracking-tight text-slate-900">
            本次面试复盘
          </h2>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">总分</div>
            {isLoading ? (
              <div className="h-10 w-20 bg-slate-200 rounded animate-pulse mt-1" />
            ) : (
              <div className="flex items-baseline gap-2">
                <div className="text-[42px] font-semibold leading-none tabular-nums tracking-tight text-slate-900">
                  {currentFeedback?.overallScore ?? "—"}
                </div>
                <div className="text-[16px] text-slate-400 font-mono">/ 100</div>
              </div>
            )}
          </div>
          <div className="w-px h-12 bg-slate-200" />
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">评级</div>
            {isLoading ? (
              <div className="w-12 h-12 rounded-xl bg-slate-200 animate-pulse mt-1" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white grid place-items-center text-[22px] font-semibold mt-1">
                {currentFeedback ? gradeLabel(currentFeedback.overallScore) : "—"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Question tabs */}
      {!isDemo && count > 1 && (
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {completedThreads.map((thread, i) => (
            <button
              key={i}
              onClick={() => setSelectedIdx(i)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition ${
                selectedIdx === i
                  ? "bg-indigo-600 text-white"
                  : "bg-white ring-1 ring-slate-200 text-slate-600 hover:ring-indigo-300"
              }`}
            >
              <span>Q{i + 1}</span>
              <span className="hidden sm:inline text-[11px] opacity-70 truncate max-w-[120px]">
                {thread.mainQuestion.category}
              </span>
              {/* Exchange depth badge */}
              {thread.exchanges.length > 1 && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    selectedIdx === i
                      ? "bg-white/20 text-white"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  +{thread.exchanges.length - 1}追问
                </span>
              )}
              {loadingStates[i] && (
                <svg
                  className="w-3.5 h-3.5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M12 3a9 9 0 1 0 9 9" />
                </svg>
              )}
              {!loadingStates[i] && feedbacks[i] && !fetchErrors[i] && (
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {!loadingStates[i] && fetchErrors[i] && (
                <svg
                  className="w-3.5 h-3.5 text-rose-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Exchange depth info for current thread */}
      {!isDemo && exchangeCount > 1 && (
        <div className="mb-4 flex items-center gap-2 text-[12px] text-slate-500">
          <svg
            viewBox="0 0 24 24"
            className="w-3.5 h-3.5 text-amber-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          </svg>
          <span>
            本题共 {exchangeCount} 轮对话（1 主问题 + {exchangeCount - 1} 次追问），以下为综合评分
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {hasError ? (
          <ErrorCard message={fetchError!} onRetry={() => fetchOne(selectedIdx)} />
        ) : (
          <>
            <FeedbackCard
              isLoading={isLoading}
              strengths={currentFeedback?.strengths ?? []}
              improvements={currentFeedback?.improvements ?? []}
              modelAnswer={currentFeedback?.modelAnswer ?? ""}
              thinkingTimeFeedback={currentFeedback?.thinkingTimeFeedback ?? ""}
            />

            {isLoading || !currentFeedback ? (
              <RadarCardSkeleton />
            ) : (
              <div className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-6 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[14px] font-semibold">能力雷达</div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm bg-indigo-600" />
                      本次表现
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm bg-slate-200" />
                      满分基准
                    </span>
                  </div>
                </div>

                <div className="flex-1 flex items-center justify-center -my-2">
                  <RadarChart dims={radarDims} centerScore={currentFeedback.overallScore} />
                </div>

                <div className="grid grid-cols-5 gap-2 pt-2 border-t border-slate-100">
                  {radarDims.map((d, i) => (
                    <div key={i} className="text-center">
                      <div className="text-[10px] text-slate-400 truncate">{d.key}</div>
                      <div className="text-[15px] font-mono font-semibold tabular-nums text-slate-900 mt-0.5">
                        {d.value}
                      </div>
                      <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${d.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Action row */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gradient-to-r from-indigo-50 via-indigo-50/40 to-transparent rounded-2xl px-6 py-5 ring-1 ring-indigo-100">
        <div>
          <div className="text-[15px] font-medium text-slate-900">想再练一次？</div>
          <div className="text-[12px] text-slate-500 mt-0.5">
            基于本次反馈，AI 会针对你的薄弱环节出更有针对性的题目。
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="text-[13px] px-4 py-2 rounded-lg text-slate-700 hover:bg-white transition">
            导出报告 PDF
          </button>
          <button
            onClick={onRestart}
            className="text-[13px] font-medium px-5 py-2.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition flex items-center gap-1.5"
          >
            开启新一轮面试
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
    </section>
  );
}
