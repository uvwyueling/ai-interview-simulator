"use client";

/**
 * "看一份样例报告" — the pre-upload value proof (v0.13.0).
 *
 * Why a modal and not a step
 * ──────────────────────────
 *   InputStep keeps `resume` / `jd` in local useState and page.tsx only mounts it
 *   while `step === "input"`. Routing to the feedback step would UNMOUNT it and
 *   silently wipe whatever the visitor had already pasted — the exact opposite of
 *   what this feature is for. An overlay leaves InputStep mounted, so the draft
 *   survives and "close" costs nothing.
 *
 * Layout
 * ──────
 *   Desktop: large centred dialog (the report has a radar chart + multi-column
 *   feedback; a narrow drawer would cramp the proof). Mobile: full-screen sheet.
 *
 * Content comes from lib/sampleReports.ts — real pipeline output, frozen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import RadarChart from "./RadarChart";
import FeedbackCard from "./FeedbackCard";
import { track, EVENTS } from "@/lib/analytics";
import {
  SAMPLE_PERSONAS,
  type SamplePersona,
  type SampleThread,
} from "@/lib/sampleReports";
import {
  DIMENSION_LABELS,
  feedbackToRadarDims,
  type Feedback,
  type FeedbackDimensions,
} from "@/types/interview";

// ── "Real read" thresholds ────────────────────────────────────────────────────
//
// sample_report_completed fires on the FIRST of these to hit, so a fast scroller
// and a slow reader both count — but an open-and-bounce does not. `reason` says
// which one won, so the split between "read it" and "skimmed to the end" stays
// visible in the data.

/** Dwell long enough to have actually read something. */
const DWELL_MS = 20_000;
/** Distinct core sections that must cross the reading band. */
const SECTIONS_REQUIRED = 2;
/** Treat "within this many px of the bottom" as reaching the end. */
const BOTTOM_SLACK_PX = 48;
/**
 * Shrinks the observer root to a central band, so a section counts as "read"
 * only once it passes through the middle of the panel.
 *
 * A percentage `threshold` cannot be used here: several sections (the follow-up
 * chain, the per-dimension list) are taller than the scroll container, so they
 * can never reach 50% visibility and would never register — the first cut of
 * this used threshold 0.5 and recorded sectionsSeen: 0 every time. A band plus
 * `threshold: 0` is height-independent.
 */
const READING_BAND = "-35% 0px -35% 0px";

type CompletionReason = "dwell" | "scrolled_to_end" | "sections_read";

const DIM_KEYS = Object.keys(DIMENSION_LABELS) as (keyof FeedbackDimensions)[];

/** Average the three per-question feedbacks — mirrors FeedbackStep's 汇总 tab. */
function averageDimensions(threads: SampleThread[]): {
  overallScore: number;
  dimensions: FeedbackDimensions;
} {
  const fbs: Feedback[] = threads.map((t) => t.feedback);
  const avg = (nums: number[]) =>
    Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
  return {
    overallScore: avg(fbs.map((f) => f.overallScore)),
    dimensions: DIM_KEYS.reduce((acc, k) => {
      acc[k] = avg(fbs.map((f) => f.dimensions[k]));
      return acc;
    }, {} as FeedbackDimensions),
  };
}

// ── Sub-views ─────────────────────────────────────────────────────────────────

function ThreadView({ thread }: { thread: SampleThread }) {
  const [open, setOpen] = useState(false);
  const followUps = thread.exchanges.length - 1;

  return (
    <div className="space-y-4">
      {/* The question itself — the "questions are built from YOUR résumé" proof */}
      <div
        data-section="question"
        className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-5"
      >
        <div className="text-[11px] uppercase tracking-[0.18em] text-indigo-600 mb-2">
          面试官提问
        </div>
        <p className="text-[14px] leading-relaxed text-slate-800">
          {thread.mainQuestion.text}
        </p>
      </div>

      {/* Follow-up chain — collapsed by default so the "30 秒" promise holds */}
      <div
        data-section="followups"
        className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft overflow-hidden"
      >
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-2.5 px-5 py-3.5 text-left hover:bg-slate-50 transition"
        >
          <svg
            viewBox="0 0 24 24"
            className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-[13px] font-medium text-slate-700">
            查看完整问答与追问链
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            {followUps > 0 ? `${followUps} 轮追问` : "无追问"}
          </span>
        </button>

        {open && (
          <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
            {thread.exchanges.map((ex, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-start gap-2.5">
                  <span
                    className={`shrink-0 mt-0.5 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                      ex.depth === 0
                        ? "bg-indigo-50 text-indigo-600"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {ex.depth === 0 ? "主问" : `追问 ${ex.depth}`}
                  </span>
                  <p className="text-[13px] leading-relaxed text-slate-700">
                    {ex.question}
                  </p>
                </div>
                <p className="text-[13px] leading-[1.75] text-slate-500 whitespace-pre-line pl-[52px]">
                  {ex.answer}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div data-section="verdict">
        <FeedbackCard
          strengths={thread.feedback.strengths}
          improvements={thread.feedback.improvements}
          thinkingTimeFeedback={thread.feedback.thinkingTimeFeedback}
        />
      </div>

      {/* Per-dimension detail — the part that reads as "it actually listened" */}
      <div
        data-section="dimensions"
        className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-6"
      >
        <div className="text-[14px] font-semibold mb-4">分维度点评</div>
        <div className="space-y-4">
          {DIM_KEYS.map((k) => (
            <div key={k}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[13px] font-medium text-slate-800">
                  {DIMENSION_LABELS[k]}
                </span>
                <span className="text-[11px] font-mono text-indigo-600">
                  {thread.feedback.dimensions[k]}
                </span>
              </div>
              <ul className="space-y-1.5">
                {thread.feedback.dimensionDetails[k].map((d, i) => (
                  <li
                    key={i}
                    className="text-[12.5px] leading-relaxed text-slate-600 pl-3 border-l-2 border-slate-100"
                  >
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type Props = {
  onClose: () => void;
  /** Close and drop the visitor on the résumé field — the whole point of the modal. */
  onStartOwn: () => void;
};

export default function SampleReportModal({ onClose, onStartOwn }: Props) {
  const [personaKey, setPersonaKey] = useState(SAMPLE_PERSONAS[0].key);
  const [threadIdx, setThreadIdx] = useState(0);
  // Portal target. InputStep's root <section> carries `.fade-up`, whose
  // `animation-fill-mode: both` leaves `transform: translateY(0)` on the element
  // forever — and a transformed ancestor becomes the containing block for
  // `position: fixed` children. Rendered in place, this overlay anchors to that
  // section instead of the viewport and drifts off-screen once the page is
  // scrolled (observed: modal top at -33px). Portalling to <body> escapes any
  // such ancestor, here or anywhere else it later gets mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionsSeen = useRef<Set<string>>(new Set());
  const completedFired = useRef(false);
  const openedAt = useRef(Date.now());

  const persona: SamplePersona =
    SAMPLE_PERSONAS.find((p) => p.key === personaKey) ?? SAMPLE_PERSONAS[0];
  const summary = useMemo(() => averageDimensions(persona.threads), [persona]);

  const fireCompleted = useCallback(
    (reason: CompletionReason) => {
      if (completedFired.current) return;
      completedFired.current = true;
      track(EVENTS.SAMPLE_REPORT_COMPLETED, {
        reason,
        persona: personaKey,
        dwellMs: Date.now() - openedAt.current,
        sectionsSeen: sectionsSeen.current.size,
      });
    },
    [personaKey]
  );

  // Rendered for real → the funnel's second step. Deliberately in an effect (not
  // in the click handler) so a render failure shows up as a missing event.
  useEffect(() => {
    track(EVENTS.SAMPLE_REPORT_VIEWED, { persona: SAMPLE_PERSONAS[0].key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signal 1 — dwell.
  useEffect(() => {
    const id = setTimeout(() => fireCompleted("dwell"), DWELL_MS);
    return () => clearTimeout(id);
  }, [fireCompleted]);

  // Signal 2 — reached the end of the report.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_SLACK_PX) {
      fireCompleted("scrolled_to_end");
    }
  }, [fireCompleted]);

  // Signal 3 — at least two distinct core sections entered the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const name = (e.target as HTMLElement).dataset.section;
          if (name) sectionsSeen.current.add(name);
        }
        if (sectionsSeen.current.size >= SECTIONS_REQUIRED) {
          fireCompleted("sections_read");
        }
      },
      { root, rootMargin: READING_BAND, threshold: 0 }
    );
    root
      .querySelectorAll<HTMLElement>("[data-section]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [fireCompleted, personaKey, threadIdx]);

  // Escape to close + lock the page behind the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const switchPersona = (key: typeof personaKey) => {
    setPersonaKey(key);
    setThreadIdx(0);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="样例面试报告"
    >
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Mobile: full-screen sheet. Desktop: large centred dialog. */}
      <div className="relative flex flex-col w-full sm:max-w-4xl h-full sm:h-[88vh] bg-canvas sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 sm:px-6 py-3.5 bg-white border-b border-slate-200">
          {/* Nothing in this bar may wrap — 37% of traffic is mobile, and a
              two-line persona switcher reads as broken. Labels are kept short
              enough (see sampleReports.ts) that all three fit at 375px. */}
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-900 whitespace-nowrap">
              样例报告
            </div>
            <div className="text-[11px] text-slate-400 whitespace-nowrap">
              演示内容 · 非真实候选人
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg shrink-0">
            {SAMPLE_PERSONAS.map((p) => (
              <button
                key={p.key}
                onClick={() => switchPersona(p.key)}
                className={`whitespace-nowrap px-2.5 sm:px-3 py-1.5 text-[12px] font-medium rounded-md transition ${
                  p.key === personaKey
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5"
        >
          {/* Who this candidate is — grounds everything below */}
          <div>
            <div className="text-[15px] font-semibold text-slate-900">
              {persona.candidate}
            </div>
            <div className="text-[12.5px] text-slate-500 mt-0.5">
              目标岗位：{persona.target}
            </div>
            <p className="text-[12.5px] leading-relaxed text-slate-500 mt-2.5 px-3 py-2 bg-indigo-50/60 rounded-lg">
              {persona.blurb}
            </p>
          </div>

          {/* Value proof, above the fold */}
          <div
            data-section="radar"
            className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-5"
          >
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[13px] font-semibold text-slate-800">
                能力画像 · 三题综合
              </span>
              <span className="text-[11px] text-slate-400">
                总分 {summary.overallScore} / 100
              </span>
            </div>
            <div className="flex justify-center">
              <RadarChart
                dims={feedbackToRadarDims(summary.dimensions)}
                centerScore={summary.overallScore}
              />
            </div>
          </div>

          {/* Per-question tabs */}
          <div className="flex items-center gap-1.5">
            {persona.threads.map((_, i) => (
              <button
                key={i}
                onClick={() => setThreadIdx(i)}
                className={`px-3 py-1.5 text-[12.5px] font-medium rounded-lg transition ${
                  i === threadIdx
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-indigo-300"
                }`}
              >
                第 {i + 1} 题
              </button>
            ))}
          </div>

          <div>
            <ThreadView
              key={`${personaKey}-${threadIdx}`}
              thread={persona.threads[threadIdx]}
            />
          </div>

          <p className="text-[11.5px] text-slate-400 text-center pt-1 pb-2">
            以上问题与反馈均由 AI 基于上方这份简历与 JD 实时生成，此处为固化的演示样例。
          </p>
        </div>

        {/* Footer CTA — the conversion the whole modal exists for */}
        <div className="shrink-0 flex items-center gap-3 px-5 sm:px-6 py-3.5 bg-white border-t border-slate-200">
          <p className="hidden sm:block text-[12.5px] text-slate-500 leading-snug">
            换成你的简历，题目会完全围绕你自己的经历生成。
          </p>
          <button
            onClick={onClose}
            className="sm:ml-auto text-[13px] text-slate-500 hover:text-slate-700 px-3 py-2 transition"
          >
            关闭
          </button>
          <button
            onClick={onStartOwn}
            className="flex-1 sm:flex-none text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 rounded-lg transition"
          >
            用我的简历试试 →
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
