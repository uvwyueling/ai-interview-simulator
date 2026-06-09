"use client";

import { useState, useEffect, useMemo } from "react";
import RadarChart from "./RadarChart";
import FeedbackCard from "./FeedbackCard";
import type { Feedback, FeedbackDimensions, DimensionDetails } from "@/types/interview";
import { feedbackToRadarDims, DIMENSION_LABELS } from "@/types/interview";
import { useInterview } from "@/context/InterviewContext";
import { generateReportHTML } from "@/lib/generateReport";
import { track, EVENTS } from "@/lib/analytics";

const MOCK_FEEDBACK: Feedback = {
  overallScore: 80,
  dimensions: {
    communication: 82,
    technicalDepth: 76,
    logicalThinking: 88,
    clarity: 71,
    jobFit: 84,
  },
  dimensionDetails: {
    communication: [
      "采用「背景—动作—结果」三段式开场，让面试官在 10 秒内就抓到了项目脉络。",
      "在描述协作 OT 算法时使用了大量术语却未做铺垫，对非同领域听众形成理解门槛。",
    ],
    technicalDepth: [
      "提到了「路由代码分割」「IntersectionObserver 懒挂载」「OT 批处理」三层优化方案，体现出体系化的性能优化思路。",
      "未谈及取舍——如懒挂载对滚动体验的副作用、批处理对协作实时性的影响，深度可再加强。",
    ],
    logicalThinking: [
      "三层优化按「网络传输 → 渲染层 → 业务层」顺序展开，符合性能分析的标准漏斗。",
      "回答中量化指标完整（2.8 秒 → 0.9 秒、首包 -40%、合并 60% 操作），形成了闭环论证。",
    ],
    clarity: [
      "结论先行（「最终首屏降到 0.9 秒」）是亮点，但中间段落信息密度过高，建议在每一层之间加一句小结。",
      "语速偏快导致关键数据被一带而过，下次可在量化指标前主动停顿 1 秒。",
    ],
    jobFit: [
      "JD 要求「性能优化经验」，候选人正好命中并给出了量化成果，匹配度高。",
      "JD 同时要求「复杂状态管理 / 协作编辑经验」，候选人在 OT 算法上仅一句带过，建议展开协作冲突解决案例以更贴合岗位。",
    ],
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
  thinkingTimeFeedback:
    "思考时间节奏良好，说明你在开口前有清晰的组织意识，这是一个很好的习惯。",
};

// ── Aggregation helpers (for "汇总" tab) ──────────────────────────────────────

const DIM_KEYS: (keyof FeedbackDimensions)[] = [
  "communication",
  "technicalDepth",
  "logicalThinking",
  "clarity",
  "jobFit",
];

function averageFeedback(feedbacks: Feedback[]): Feedback | null {
  const valid = feedbacks.filter((f): f is Feedback => f !== null && f !== undefined);
  if (valid.length === 0) return null;

  const avg = (nums: number[]) => Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);

  const dimensions = {
    communication: avg(valid.map((f) => f.dimensions.communication)),
    technicalDepth: avg(valid.map((f) => f.dimensions.technicalDepth)),
    logicalThinking: avg(valid.map((f) => f.dimensions.logicalThinking)),
    clarity: avg(valid.map((f) => f.dimensions.clarity)),
    jobFit: avg(valid.map((f) => f.dimensions.jobFit)),
  };

  const dimensionDetails: DimensionDetails = {
    communication: valid.flatMap((f) => f.dimensionDetails.communication),
    technicalDepth: valid.flatMap((f) => f.dimensionDetails.technicalDepth),
    logicalThinking: valid.flatMap((f) => f.dimensionDetails.logicalThinking),
    clarity: valid.flatMap((f) => f.dimensionDetails.clarity),
    jobFit: valid.flatMap((f) => f.dimensionDetails.jobFit),
  };

  return {
    overallScore: avg(valid.map((f) => f.overallScore)),
    dimensions,
    dimensionDetails,
    strengths: Array.from(new Set(valid.flatMap((f) => f.strengths))),
    improvements: Array.from(new Set(valid.flatMap((f) => f.improvements))),
    thinkingTimeFeedback: "已综合三题表现，下方为整体能力画像。",
  };
}

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
    <div className="lg:col-span-3 bg-white rounded-2xl ring-1 ring-rose-200 p-10 flex flex-col items-center gap-4 text-center">
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
  const {
    completedThreads,
    resume,
    jd,
    jumpToStep,
    feedbacks,
    setFeedbackAt,
    feedbackViewedTracked,
    markFeedbackViewed,
  } = useInterview();
  const isDemo = completedThreads.length === 0;
  const count = isDemo ? 1 : completedThreads.length;

  // `feedbacks` lives in (persisted) context — a refresh restores already-generated
  // results, so loading state starts false for anything already cached.
  const [loadingStates, setLoadingStates] = useState<boolean[]>(() =>
    Array.from({ length: count }, (_, i) => !isDemo && !feedbacks[i])
  );
  const [fetchErrors, setFetchErrors] = useState<(string | null)[]>(() =>
    new Array(count).fill(null)
  );
  // -1 = "汇总" tab (cross-question summary); 0..n = individual question
  const SUMMARY_IDX = -1;
  const [selectedIdx, setSelectedIdx] = useState<number>(
    isDemo || count === 1 ? 0 : SUMMARY_IDX
  );

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
          jd,
          thinkingTime,
          speakingTime,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成反馈失败");
      setFeedbackAt(i, data as Feedback);
    } catch (err) {
      track(EVENTS.FEEDBACK_FAILED, { index: i });
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
    // H3: fire feedback_viewed once per interview, not on every refresh.
    if (!feedbackViewedTracked) {
      track(EVENTS.FEEDBACK_VIEWED, { isDemo, count });
      markFeedbackViewed();
    }

    if (isDemo) {
      if (!feedbacks[0]) setFeedbackAt(0, MOCK_FEEDBACK);
      return;
    }

    // H1: only request threads without a cached result (refresh-safe → no re-spend).
    // Stagger the actual requests by 1.2 s each to avoid rate limits.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let delay = 0;
    completedThreads.forEach((_, i) => {
      if (feedbacks[i]) return; // already generated → reuse, don't re-fetch
      const at = delay;
      timers.push(setTimeout(() => fetchOne(i), at));
      delay += 1200;
    });
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isSummary = selectedIdx === SUMMARY_IDX;

  // Summary view aggregates across all loaded feedbacks
  const summaryFeedback = useMemo(
    () =>
      isSummary
        ? averageFeedback(feedbacks.filter((f): f is Feedback => !!f))
        : null,
    [isSummary, feedbacks]
  );
  const summaryIsLoading =
    isSummary && loadingStates.some((l) => l) && feedbacks.every((f) => !f);
  const summaryHasError =
    isSummary &&
    !summaryIsLoading &&
    !summaryFeedback &&
    fetchErrors.some((e) => !!e);

  const currentFeedback: Feedback | null = isSummary
    ? summaryFeedback
    : feedbacks[selectedIdx] ?? null;
  const isLoading = isSummary ? summaryIsLoading : loadingStates[selectedIdx];
  const fetchError = isSummary
    ? summaryHasError
      ? "部分题目反馈生成失败，请重试对应题目"
      : null
    : fetchErrors[selectedIdx];
  const hasError = !isLoading && !!fetchError && !currentFeedback;

  const radarDims = useMemo(
    () => (!isLoading && currentFeedback ? feedbackToRadarDims(currentFeedback.dimensions) : []),
    [currentFeedback, isLoading]
  );

  const gradeLabel = (score: number) =>
    score >= 85 ? "A" : score >= 75 ? "B+" : score >= 65 ? "B" : "C";

  // Exchange count for selected thread (shows follow-up depth) — only for single question
  const selectedThread =
    !isDemo && !isSummary ? completedThreads[selectedIdx] : null;
  const exchangeCount = selectedThread ? selectedThread.exchanges.length : 0;

  // Retry handler — in summary mode, retry all failed; otherwise retry current
  const handleRetry = () => {
    if (isSummary) {
      fetchErrors.forEach((e, i) => {
        if (e) fetchOne(i);
      });
    } else {
      fetchOne(selectedIdx);
    }
  };

  // PDF export — opens a print-ready HTML in a new window; user saves as PDF
  const anyLoading = loadingStates.some(Boolean);
  const canExport = isDemo || (!anyLoading && feedbacks.some(Boolean));

  const handleExportPDF = () => {
    const html = generateReportHTML(
      isDemo ? [] : completedThreads,
      isDemo ? [MOCK_FEEDBACK] : feedbacks,
      isDemo
    );
    const win = window.open("", "_blank");
    if (!win) {
      alert("请允许浏览器打开弹出窗口，然后重试");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    track(EVENTS.REPORT_EXPORTED, { isDemo, questionCount: isDemo ? 1 : completedThreads.length });
    // Slight delay so the browser finishes parsing before the print dialog opens
    setTimeout(() => win.print(), 400);
  };

  return (
    <section className="fade-up max-w-[1240px] mx-auto px-6 lg:px-10 pt-10 pb-20">
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
                示例反馈 · 仅供预览
              </div>
              <div className="text-[12px] text-amber-800/80 mt-0.5">
                以下评分、雷达图与改进建议均为演示内容。完成一次真实面试即可获得基于你回答的专属反馈。
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

      {/* Question tabs (with cross-question Summary tab) */}
      {!isDemo && count > 1 && (
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {/* Summary tab */}
          <button
            onClick={() => setSelectedIdx(SUMMARY_IDX)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition ${
              isSummary
                ? "bg-indigo-600 text-white"
                : "bg-white ring-1 ring-slate-200 text-slate-600 hover:ring-indigo-300"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
            <span>汇总</span>
          </button>

          <div className="w-px h-5 bg-slate-200 mx-1" />

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

      {/* Summary tab subtitle */}
      {isSummary && !isLoading && currentFeedback && (
        <div className="mb-4 flex items-center gap-2 text-[12px] text-slate-500">
          <svg
            viewBox="0 0 24 24"
            className="w-3.5 h-3.5 text-indigo-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3v18h18" />
            <polyline points="7 14 11 10 15 13 21 7" />
          </svg>
          <span>
            已综合 {feedbacks.filter((f) => !!f).length} / {count} 题反馈，下方为整体能力画像
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[25fr_45fr_30fr] gap-6 lg:h-[640px]">
        {hasError ? (
          <ErrorCard message={fetchError!} onRetry={handleRetry} />
        ) : (
          <>
            {/* Column A · Text feedback (优点 / 改进 / 思考节奏) — internal scroll if overflowing */}
            <div className="lg:overflow-y-auto lg:min-h-0">
              <FeedbackCard
                isLoading={isLoading}
                strengths={currentFeedback?.strengths ?? []}
                improvements={currentFeedback?.improvements ?? []}
                thinkingTimeFeedback={currentFeedback?.thinkingTimeFeedback ?? ""}
              />
            </div>

            {/* Column B · Radar chart only — no scroll, radar fills available space */}
            {isLoading || !currentFeedback ? (
              <RadarCardSkeleton />
            ) : (
              <div className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-6 flex flex-col gap-4 lg:min-h-0 lg:overflow-hidden">
                <div className="flex items-center justify-between shrink-0">
                  <div className="text-[14px] font-semibold">
                    {isSummary ? "综合能力雷达" : "能力雷达"}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm bg-indigo-600" />
                      {isSummary ? "平均表现" : "本次表现"}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm bg-slate-200" />
                      满分基准
                    </span>
                  </div>
                </div>

                <div className="flex-1 flex items-center justify-center min-h-0">
                  <RadarChart dims={radarDims} centerScore={currentFeedback.overallScore} />
                </div>
              </div>
            )}

            {/* Column C · Per-dimension detail list — fixed header + internal scroll */}
            {isLoading || !currentFeedback ? (
              <div className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft flex flex-col lg:min-h-0 lg:overflow-hidden">
                <div className="px-6 pt-6 pb-3 border-b border-slate-100 shrink-0">
                  <Sk className="h-4 w-20" />
                </div>
                <div className="flex-1 px-6 py-5 space-y-5 lg:overflow-y-auto lg:min-h-0">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="space-y-2">
                      <Sk className="h-3.5 w-32" />
                      <Sk className="h-3 w-full" />
                      <Sk className="h-3 w-4/5" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft flex flex-col lg:min-h-0 lg:overflow-hidden">
                {/* Fixed header */}
                <div className="text-[14px] font-semibold px-6 pt-6 pb-3 border-b border-slate-100 shrink-0">
                  维度详情
                </div>

                {/* Scrolling body */}
                <div className="flex-1 px-6 py-5 space-y-5 lg:overflow-y-auto lg:min-h-0">
                  {DIM_KEYS.map((dimKey) => {
                    const score = currentFeedback.dimensions[dimKey];
                    const bullets = currentFeedback.dimensionDetails[dimKey];
                    return (
                      <div key={dimKey}>
                        <div className="text-[13px] font-medium text-slate-800 mb-2">
                          {DIMENSION_LABELS[dimKey]}
                          <span className="ml-1.5 font-mono font-semibold tabular-nums text-slate-900">
                            ({score}
                            <span className="text-slate-400">/100</span>)
                          </span>
                        </div>
                        <ul className="space-y-1.5">
                          {bullets.map((b, j) => (
                            <li
                              key={j}
                              className="flex gap-2.5 text-[13px] leading-relaxed text-slate-700"
                            >
                              <span className="block w-1 h-1 rounded-full bg-indigo-400 shrink-0 mt-[9px]" />
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
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
          <button
            onClick={handleExportPDF}
            disabled={!canExport}
            className={`text-[13px] px-4 py-2 rounded-lg transition flex items-center gap-1.5 ${
              canExport
                ? "text-slate-700 hover:bg-white"
                : "text-slate-400 cursor-not-allowed"
            }`}
          >
            {anyLoading && !isDemo ? (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            )}
            {anyLoading && !isDemo ? "生成中…" : "导出报告 PDF"}
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
