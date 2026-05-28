"use client";

export type FeedbackCardData = {
  strengths: string[];
  improvements: string[];
  thinkingTimeFeedback: string;
};

type Props = FeedbackCardData & {
  isLoading?: boolean;
};

function Sk({ className = "" }: { className?: string }) {
  return <div className={`bg-slate-200 rounded animate-pulse ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {/* Banner skeleton */}
      <Sk className="h-12 w-full rounded-xl" />

      {/* Strengths skeleton */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sk className="w-7 h-7 rounded-lg" />
          <Sk className="h-4 w-16" />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <Sk className="w-5 h-3 mt-1 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Sk className="h-3.5 w-2/5" />
              <Sk className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>

      {/* Improvements skeleton */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sk className="w-7 h-7 rounded-lg" />
          <Sk className="h-4 w-16" />
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Sk className="w-5 h-3 mt-1 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Sk className="h-3.5 w-2/5" />
              <Sk className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FeedbackCard({
  strengths,
  improvements,
  thinkingTimeFeedback,
  isLoading = false,
}: Props) {
  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      {/* Thinking time banner */}
      <div className="flex items-start gap-2.5 px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <p className="text-[13px] text-indigo-900/80 leading-relaxed">
          <span className="font-medium">思考节奏：</span>
          {thinkingTimeFeedback}
        </p>
      </div>

      {/* Strengths — green border */}
      <div className="bg-white rounded-2xl ring-1 ring-emerald-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 grid place-items-center shrink-0">
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <span className="text-[14px] font-semibold">优点</span>
          <span className="ml-auto text-[11px] text-slate-400 font-mono">
            {strengths.length} ITEMS
          </span>
        </div>
        <ul className="space-y-2.5">
          {strengths.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-[11px] font-mono font-semibold text-emerald-600 mt-0.5 w-5 shrink-0">
                0{i + 1}
              </span>
              <span className="text-[13px] leading-relaxed text-slate-700">
                {s}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Improvements — orange border */}
      <div className="bg-white rounded-2xl ring-1 ring-amber-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 grid place-items-center shrink-0">
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2 2 22h20z" />
              <line x1="12" y1="9" x2="12" y2="14" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <span className="text-[14px] font-semibold">改进点</span>
          <span className="ml-auto text-[11px] text-slate-400 font-mono">
            {improvements.length} ITEMS
          </span>
        </div>
        <ul className="space-y-2.5">
          {improvements.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-[11px] font-mono font-semibold text-amber-600 mt-0.5 w-5 shrink-0">
                0{i + 1}
              </span>
              <span className="text-[13px] leading-relaxed text-slate-700">
                {s}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
