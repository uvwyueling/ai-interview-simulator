"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Question, Answer } from "@/types/interview";

type Step = "input" | "interview" | "feedback";

type InterviewState = {
  step: Step;
  resume: string;
  jd: string;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Answer[];
};

type InterviewActions = {
  startInterview: (questions: Question[], resume: string, jd: string) => void;
  submitAnswer: (answer: Answer) => void;
  nextQuestion: () => void;
  goToFeedback: () => void;
  jumpToStep: (step: Step) => void;
  reset: () => void;
};

const InterviewContext = createContext<(InterviewState & InterviewActions) | null>(null);

export function InterviewProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("input");
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);

  const startInterview = (qs: Question[], res: string, jdText: string) => {
    setQuestions(qs);
    setResume(res);
    setJd(jdText);
    setCurrentQuestionIndex(0);
    setAnswers([]);
    setStep("interview");
  };

  const submitAnswer = (answer: Answer) => {
    setAnswers((prev) => [...prev, answer]);
  };

  const nextQuestion = () => {
    setCurrentQuestionIndex((i) => i + 1);
  };

  const goToFeedback = () => {
    setStep("feedback");
  };

  const jumpToStep = (s: Step) => {
    setStep(s);
  };

  const reset = () => {
    setStep("input");
    setResume("");
    setJd("");
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setAnswers([]);
  };

  return (
    <InterviewContext.Provider
      value={{
        step,
        resume,
        jd,
        questions,
        currentQuestionIndex,
        answers,
        startInterview,
        submitAnswer,
        nextQuestion,
        goToFeedback,
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
