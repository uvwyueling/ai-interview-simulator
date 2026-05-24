"use client";

import { InterviewProvider, useInterview } from "@/context/InterviewContext";
import Header from "@/components/Header";
import InputStep from "@/components/InputStep";
import InterviewStep from "@/components/InterviewStep";
import FeedbackStep from "@/components/FeedbackStep";

const STEP_NUM = { input: 0, interview: 1, feedback: 2 } as const;
const STEP_LABELS = ["输入", "面试", "反馈"] as const;
const STEP_KEYS = ["input", "interview", "feedback"] as const;

function ProgressBar() {
  const { questions, currentQuestionIndex } = useInterview();
  const total = questions.length;
  if (total === 0) return null;
  const pct = (currentQuestionIndex / total) * 100;

  return (
    <div className="max-w-[1240px] mx-auto px-6 lg:px-10 py-3 flex items-center gap-4">
      <div className="text-[12px] text-slate-500 whitespace-nowrap">
        第 <span className="font-semibold text-slate-900">{currentQuestionIndex + 1}</span> 题
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

function AppContent() {
  const { step, questions, reset, jumpToStep } = useInterview();

  return (
    <div className="min-h-screen bg-canvas">
      <Header step={STEP_NUM[step]} />
      {step === "interview" && <ProgressBar />}
      {step === "input" && <InputStep />}
      {step === "interview" && questions.length > 0 && <InterviewStep />}
      {step === "feedback" && (
        <FeedbackStep onRestart={reset} />
      )}

      {/* Demo step jumper */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur ring-1 ring-slate-200 ring-soft rounded-full px-2 py-1.5 flex items-center gap-1 text-[11px] z-30">
        <span className="px-2 text-slate-400 font-mono">DEMO</span>
        {STEP_KEYS.map((s, i) => (
          <button
            key={s}
            onClick={() => jumpToStep(s)}
            className={`px-3 py-1 rounded-full transition ${step === s ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
          >
            {STEP_LABELS[i]}
          </button>
        ))}
      </div>
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
