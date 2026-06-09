import type { CSSProperties } from "react";

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative w-8 h-8 rounded-lg bg-indigo-600 grid place-items-center ring-soft">
        <div className="absolute inset-0.5 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-700"></div>
        <svg
          viewBox="0 0 24 24"
          className="relative w-4 h-4 text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4z" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight whitespace-nowrap">Echo Interview</div>
        <div className="text-[11px] text-slate-500 -mt-0.5 whitespace-nowrap">AI Mock Interview · Demo</div>
      </div>
    </div>
  );
}

function StepBar({ step }: { step: number }) {
  const steps = ["准备资料", "正式面试", "复盘反馈"];
  const pct = step === 0 ? 0 : step === 1 ? 50 : 100;

  return (
    <div className="flex items-center gap-6">
      <div className="hidden md:flex items-center gap-3">
        {steps.map((s, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`w-6 h-6 grid place-items-center rounded-full text-[11px] font-semibold transition-all
                  ${done ? "bg-indigo-600 text-white" : active ? "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-600" : "bg-slate-100 text-slate-400"}`}
              >
                {done ? "✓" : i + 1}
              </div>
              <div
                className={`text-[13px] ${active ? "text-slate-900 font-medium" : done ? "text-slate-500" : "text-slate-400"}`}
              >
                {s}
              </div>
              {i < steps.length - 1 && (
                <div className="w-8 h-px bg-slate-200 mx-1"></div>
              )}
            </div>
          );
        })}
      </div>
      <div
        className="md:hidden w-16 sm:w-40 h-1.5 rounded-full stepline shrink-0"
        style={{ "--p": `${pct}%` } as CSSProperties}
      ></div>
    </div>
  );
}

export default function Header({ step }: { step: number }) {
  return (
    <header className="border-b border-slate-200/70 bg-white/70 backdrop-blur sticky top-0 z-20">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between gap-3">
        <Logo />
        <StepBar step={step} />
      </div>
    </header>
  );
}
