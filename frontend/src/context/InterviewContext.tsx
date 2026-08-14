"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { Question, Exchange, QuestionThread, Feedback } from "@/types/interview";
import { track, EVENTS } from "@/lib/analytics";
import { reportInterviewCompleted } from "@/lib/gtag";

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
  // Persisted so a refresh on the feedback page does NOT re-generate (re-spend on)
  // every question's feedback. Indexed by main-question/thread index.
  feedbacks: (Feedback | null)[];
  // Persisted so `feedback_viewed` is counted once per interview, not on every
  // refresh of the feedback page.
  feedbackViewedTracked: boolean;
  // 👍/👎 ratings keyed by target (e.g. "fb:0", "fb:summary", "fu:0:1"). Persisted
  // so a refresh restores the user's choice and avoids double-counting.
  ratings: Record<string, number>;
  // Whether the user has submitted the "let's chat" contact form this session.
  // Persisted so a refresh doesn't re-show the CTA after they already replied.
  contactSubmitted: boolean;
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
  feedbacks: (Feedback | null)[];  // per-thread feedback results (persisted)
  feedbackViewedTracked: boolean;  // whether feedback_viewed has fired this interview
  ratings: Record<string, number>; // 👍/👎 ratings keyed by target (persisted)
  contactSubmitted: boolean;       // whether user submitted the contact CTA (persisted)
};

type InterviewActions = {
  startInterview: (questions: Question[], resume: string, jd: string, isDemo: boolean) => void;
  /** Add one exchange to the current question's history (for display). */
  appendExchange: (exchange: Exchange) => void;
  setIsJudging: (v: boolean) => void;
  setPendingFollowUp: (q: string | null) => void;
  /** Store one thread's feedback result (auto-grows the array). */
  setFeedbackAt: (index: number, feedback: Feedback) => void;
  /** Mark feedback_viewed as already tracked for this interview. */
  markFeedbackViewed: () => void;
  /** Record a 👍/👎 rating under a key (1 = up, -1 = down). */
  setRating: (key: string, value: number) => void;
  /** Mark the contact CTA as submitted so it's not re-shown after refresh. */
  markContactSubmitted: () => void;
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
  const [feedbacks, setFeedbacks] = useState<(Feedback | null)[]>([]);
  const [feedbackViewedTracked, setFeedbackViewedTracked] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [contactSubmitted, setContactSubmitted] = useState(false);

  // Tracks whether we have loaded from sessionStorage.
  // MUST be state, not a ref: under React StrictMode (dev) effects run twice —
  // with a ref, the second SAVE pass sees isHydrated=true while its closure
  // still holds the default (blank) state, overwriting the stored session
  // before the second HYDRATE pass re-reads it. Uncommitted state stays false
  // in that second pass, so the save correctly skips.
  const [isHydrated, setIsHydrated] = useState(false);

  // ── SAVE effect (declared first — runs before hydrate on initial mount) ──────
  useEffect(() => {
    if (!isHydrated) return; // skip until hydration has been applied
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
      feedbacks,
      feedbackViewedTracked,
      ratings,
      contactSubmitted,
    });
  }, [
    isHydrated,
    step, resume, jd, questions, isDemo,
    currentMainIndex, currentExchanges,
    pendingFollowUpQuestion, completedThreads,
    feedbacks, feedbackViewedTracked, ratings, contactSubmitted,
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
      setFeedbacks(saved.feedbacks ?? []);
      setFeedbackViewedTracked(saved.feedbackViewedTracked ?? false);
      setRatings(saved.ratings ?? {});
      setContactSubmitted(saved.contactSubmitted ?? false);
    }
    setIsHydrated(true);
  }, []); // runs exactly once on mount (twice under StrictMode — safe, see above)

  // ── Actions ───────────────────────────────────────────────────────────────────

  const startInterview = (qs: Question[], res: string, jdText: string, demo: boolean) => {
    setQuestions(qs);
    setResume(res);
    setJd(jdText);
    setIsDemo(demo);
    setCurrentMainIndex(0);
    setCurrentExchanges([]);
    setCompletedThreads([]);
    setFeedbacks([]);
    setFeedbackViewedTracked(false);
    setRatings({});
    setContactSubmitted(false);
    setIsJudgingState(false);
    setPendingFollowUpState(null);
    setStep("interview");
    track(EVENTS.INTERVIEW_STARTED, { isDemo: demo, questionCount: qs.length });
  };

  const appendExchange = (exchange: Exchange) => {
    setCurrentExchanges((prev) => [...prev, exchange]);
  };

  const setIsJudging = (v: boolean) => setIsJudgingState(v);
  const setPendingFollowUp = (q: string | null) => setPendingFollowUpState(q);

  const setFeedbackAt = (index: number, feedback: Feedback) => {
    setFeedbacks((prev) => {
      const n = [...prev];
      while (n.length <= index) n.push(null);
      n[index] = feedback;
      return n;
    });
  };

  const markFeedbackViewed = () => setFeedbackViewedTracked(true);

  const setRating = (key: string, value: number) =>
    setRatings((prev) => ({ ...prev, [key]: value }));

  const markContactSubmitted = () => setContactSubmitted(true);

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
      track(EVENTS.INTERVIEW_COMPLETED, {
        isDemo,
        questionCount: questions.length,
      });
      // Google Ads conversion — but never for a demo run. `isDemo` is NOT a
      // dev-only flag: InputStep's sample fast-path (untouched sample resume +
      // JD) sets it in production too. Counting those would train the bidding
      // algorithm to buy clicks from people who tap the sample and leave
      // without ever pasting a resume of their own.
      if (!isDemo) reportInterviewCompleted();
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
    setFeedbacks([]);
    setFeedbackViewedTracked(false);
    setRatings({});
    setContactSubmitted(false);
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
        feedbacks,
        feedbackViewedTracked,
        ratings,
        contactSubmitted,
        startInterview,
        appendExchange,
        setIsJudging,
        setPendingFollowUp,
        setFeedbackAt,
        markFeedbackViewed,
        setRating,
        markContactSubmitted,
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
