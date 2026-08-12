"use client";

import { useEffect } from "react";
import { InterviewProvider, useInterview } from "@/context/InterviewContext";
import { trackLanded, trackFirstInteraction } from "@/lib/analytics";
import Header from "@/components/Header";
import InputStep from "@/components/InputStep";
import InterviewStep from "@/components/InterviewStep";
import FeedbackStep from "@/components/FeedbackStep";
import type { Question } from "@/types/interview";

// ── Demo mock data (used when jumping to interview/feedback without real data) ──

const DEMO_RESUME = `张同学 · 应届硕士
教育：计算机科学硕士，2024
经历：ByteSpark 实习（前端工程师，6 个月）· Hackday 一等奖 — 实时协作白板
技能：React、TypeScript、Node.js、Python、图算法`;

const DEMO_JD = `资深前端工程师 · 上海
要求：3+ 年 React 经验，熟悉性能优化，复杂状态管理 / 协作编辑经验优先`;

const DEMO_QUESTIONS: Question[] = [
  {
    id: "q1",
    text: "请介绍你在 ByteSpark 实习期间最有挑战性的项目，你是如何解决核心技术难题的？",
    category: "项目经历",
    difficulty: "medium",
  },
  {
    id: "q2",
    text: "如果要设计一个支持多人实时协作的白板应用，你会如何考虑前端架构和状态同步方案？",
    category: "方案设计",
    difficulty: "hard",
  },
  {
    id: "q3",
    text: "请解释 React 中 useCallback 与 useMemo 的区别，以及各自适用的场景。",
    category: "专业深度",
    difficulty: "easy",
  },
];

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar() {
  const { questions, currentMainIndex } = useInterview();
  const total = questions.length;
  if (total === 0) return null;
  const pct = (currentMainIndex / total) * 100;

  return (
    <div className="max-w-[1240px] mx-auto px-6 lg:px-10 py-3 flex items-center gap-4">
      <div className="text-[12px] text-slate-500 whitespace-nowrap">
        主题 <span className="font-semibold text-slate-900">{currentMainIndex + 1}</span>
        {" "}/ 共 <span className="font-semibold text-slate-900">{total}</span> 题
      </div>
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────

const STEP_NUM = { input: 0, interview: 1, feedback: 2 } as const;
const STEP_LABELS = ["输入", "面试", "反馈"] as const;
const STEP_KEYS = ["input", "interview", "feedback"] as const;

function AppContent() {
  const { step, questions, reset, jumpToStep, startInterview } = useInterview();

  // Top of the funnel: record the landing, then wait for the first real gesture
  // (human signal). Listeners self-remove after the first fire.
  useEffect(() => {
    trackLanded();
    const onInteract = () => {
      trackFirstInteraction();
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("touchstart", onInteract);
    };
    window.addEventListener("pointerdown", onInteract, { passive: true });
    window.addEventListener("keydown", onInteract);
    window.addEventListener("touchstart", onInteract, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("touchstart", onInteract);
    };
  }, []);

  const handleDemoJump = (s: (typeof STEP_KEYS)[number]) => {
    if (s === "interview" && questions.length === 0) {
      // Pre-fill mock data so InterviewStep has something to render
      startInterview(DEMO_QUESTIONS, DEMO_RESUME, DEMO_JD, true);
    } else {
      jumpToStep(s);
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <Header step={STEP_NUM[step]} />
      {step === "interview" && <ProgressBar />}
      {step === "input" && <InputStep />}
      {step === "interview" && questions.length > 0 && <InterviewStep />}
      {step === "feedback" && <FeedbackStep onRestart={reset} />}

      {/* Demo step jumper — dev only; never shown to real (beta) users */}
      {process.env.NODE_ENV !== "production" && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur ring-1 ring-slate-200 ring-soft rounded-full px-2 py-1.5 flex items-center gap-1 text-[11px] z-30">
          <span className="px-2 text-slate-400 font-mono">DEMO</span>
          {STEP_KEYS.map((s, i) => (
            <button
              key={s}
              onClick={() => handleDemoJump(s)}
              className={`px-3 py-1 rounded-full transition whitespace-nowrap ${step === s ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            >
              {STEP_LABELS[i]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <InterviewProvider>
      <AppContent />
    </InterviewProvider>
  );
}
