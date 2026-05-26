"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Question, Exchange, QuestionThread } from "@/types/interview";

type Step = "input" | "interview" | "feedback";

type InterviewState = {
  step: Step;
  resume: string;
  jd: string;
  questions: Question[];           // 3 main questions
  isDemo: boolean;
  currentMainIndex: number;        // 0–2
  currentExchanges: Exchange[];    // exchanges for the current main question
  isJudging: boolean;              // follow-up API call in progress
  pendingFollowUpQuestion: string | null;  // follow-up question text from LLM
  completedThreads: QuestionThread[];     // finalised threads (used by FeedbackStep)
};

type InterviewActions = {
  startInterview: (
    questions: Question[],
    resume: string,
    jd: string,
    isDemo: boolean
  ) => void;
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

export function InterviewProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("input");
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [currentMainIndex, setCurrentMainIndex] = useState(0);
  const [currentExchanges, setCurrentExchanges] = useState<Exchange[]>([]);
  const [isJudging, setIsJudgingState] = useState(false);
  const [pendingFollowUpQuestion, setPendingFollowUpState] = useState<string | null>(null);
  const [completedThreads, setCompletedThreads] = useState<QuestionThread[]>([]);

  const startInterview = (
    qs: Question[],
    res: string,
    jdText: string,
    demo: boolean
  ) => {
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
