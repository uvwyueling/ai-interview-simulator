"use client";

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import type { Question, Exchange, QuestionThread } from "@/types/interview";

type Step = "input" | "interview" | "feedback";

// ── sessionStorage persistence ────────────────────────────────────────────────
//
// What IS persisted:   all data the user would lose on refresh
// What is NOT:         isJudging (in-flight API state — can't resume after refresh)
//
// Effect ordering contract (critical):
//   The SAVE effect must be declared BEFORE the HYDRATE effect so React runs it
//   first on initial mount.  On first mount, isHydrated.current is still false,
//   so the save skips — preventing the default blank state from overwriting the
//   stored session before hydration can read it.

const SESSION_KEY = "ai_interview_session";

type PersistedState = {
  step: Step;
  resume: string;
  jd: string;
  questions: Question[];
  isDemo: boolean;
  currentMainIndex: number;
  currentExchanges: Exchange[];
  pendingFollowUpQuestion: string | null;
  completedThreads: QuestionThread[];
};

function readSession(): PersistedState | null {
  if (typeof window === "undefined") return null; // SSR guard
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null; // corrupt data — start fresh
  }
}

function writeSession(state: PersistedState): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or private-browsing restrictions — fail silently
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

// ── Context types ─────────────────────────────────────────────────────────────

type InterviewState = {
  step: Step;
  resume: string;
  jd: string;
  questions: Question[];           // 3 main questions
  isDemo: boolean;
  currentMainIndex: number;        // 0–2
  currentExchanges: Exchange[];    // exchanges for the current main question
  isJudging: boolean;              // follow-up API call in progress (not persisted)
  pendingFollowUpQuestion: string | null;
  completedThreads: QuestionThread[];
};

type InterviewActions = {
  startInterview: (questions: Question[], resume: string, jd: string, isDemo: boolean) => void;
  /** Add one exchange to the current question's history (for display). */
  appendExchange: (exchange: Exchange) => void;
  setIsJudging: (v: boolean) => void;
  setPendingFollowUp: (q: string | null) => void;
  /**
   * Finalise the current main question with the given exchanges, then
   * advance to the next main question or go to the feedback step.
   * Accepts the complete exchanges array to avoid stale-closure issues.
   */
  advanceToNext: (finalExchanges: Exchange[]) => void;
  jumpToStep: (step: Step) => void;
  reset: () => void;
};

const InterviewContext = createContext<(InterviewState & InterviewActions) | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function InterviewProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("input");
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [currentMainIndex, setCurrentMainIndex] = useState(0);
  const [currentExchanges, setCurrentExchanges] = useState<Exchange[]>([]);
  const [isJudging, setIsJudgingState] = useState(false); // never persisted
  const [pendingFollowUpQuestion, setPendingFollowUpState] = useState<string | null>(null);
  const [completedThreads, setCompletedThreads] = useState<QuestionThread[]>([]);

  // Tracks whether we have loaded from sessionStorage.
  // Using a ref (not state) so toggling it doesn't trigger an extra render.
  const isHydrated = useRef(false);

  // ── SAVE effect (declared first — runs before hydrate on initial mount) ──────
  useEffect(() => {
    if (!isHydrated.current) return; // skip the pre-hydration render
    writeSession({
      step,
      resume,
      jd,
      questions,
      isDemo,
      currentMainIndex,
      currentExchanges,
      pendingFollowUpQuestion,
      completedThreads,
    });
  }, [
    step, resume, jd, questions, isDemo,
    currentMainIndex, currentExchanges,
    pendingFollowUpQuestion, completedThreads,
  ]);

  // ── HYDRATE effect (declared second — runs after save on initial mount) ──────
  useEffect(() => {
    const saved = readSession();
    if (saved?.step) {
      setStep(saved.step);
      setResume(saved.resume ?? "");
      setJd(saved.jd ?? "");
      setQuestions(saved.questions ?? []);
      setIsDemo(saved.isDemo ?? false);
      setCurrentMainIndex(saved.currentMainIndex ?? 0);
      setCurrentExchanges(saved.currentExchanges ?? []);
      setPendingFollowUpState(saved.pendingFollowUpQuestion ?? null);
      setCompletedThreads(saved.completedThreads ?? []);
    }
    isHydrated.current = true;
  }, []); // runs exactly once on mount

  // ── Actions ───────────────────────────────────────────────────────────────────

  const startInterview = (qs: Question[], res: string, jdText: string, demo: boolean) => {
    setQuestions(qs);
    setResume(res);
    setJd(jdText);
    setIsDemo(demo);
    setCurrentMainIndex(0);
    setCurrentExchanges([]);
    setCompletedThreads([]);
    setIsJudgingState(false);
    setPendingFollowUpState(null);
    setStep("interview");
  };

  const appendExchange = (exchange: Exchange) => {
    setCurrentExchanges((prev) => [...prev, exchange]);
  };

  const setIsJudging = (v: boolean) => setIsJudgingState(v);
  const setPendingFollowUp = (q: string | null) => setPendingFollowUpState(q);

  const advanceToNext = (finalExchanges: Exchange[]) => {
    const thread: QuestionThread = {
      mainQuestion: questions[currentMainIndex],
      exchanges: finalExchanges,
    };
    setCompletedThreads((prev) => [...prev, thread]);
    setPendingFollowUpState(null);
    setIsJudgingState(false);

    const nextIndex = currentMainIndex + 1;
    if (nextIndex < questions.length) {
      setCurrentMainIndex(nextIndex);
      setCurrentExchanges([]);
    } else {
      setStep("feedback");
    }
  };

  const jumpToStep = (s: Step) => setStep(s);

  const reset = () => {
    clearSession(); // wipe persisted state so the next session starts clean
    setStep("input");
    setResume("");
    setJd("");
    setQuestions([]);
    setIsDemo(false);
    setCurrentMainIndex(0);
    setCurrentExchanges([]);
    setCompletedThreads([]);
    setIsJudgingState(false);
    setPendingFollowUpState(null);
  };

  return (
    <InterviewContext.Provider
      value={{
        step,
        resume,
        jd,
        questions,
        isDemo,
        currentMainIndex,
        currentExchanges,
        isJudging,
        pendingFollowUpQuestion,
        completedThreads,
        startInterview,
        appendExchange,
        setIsJudging,
        setPendingFollowUp,
        advanceToNext,
        jumpToStep,
        reset,
      }}
    >
      {children}
    </InterviewContext.Provider>
  );
}

export function useInterview() {
  const ctx = useContext(InterviewContext);
  if (!ctx) throw new Error("useInterview must be used within InterviewProvider");
  return ctx;
}
