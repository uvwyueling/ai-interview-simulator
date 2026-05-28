export type Question = {
  id: string;
  text: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
};

export type Answer = {
  questionId: string;
  transcript: string;
  durationSeconds: number;
  thinkingTimeMs: number;
};

export type Exchange = {
  question: Question;
  answer: Answer;
};

export type QuestionThread = {
  mainQuestion: Question;
  exchanges: Exchange[]; // first = main Q&A, subsequent = follow-up Q&As
};

export type FeedbackDimensions = {
  communication: number;
  technicalDepth: number;
  logicalThinking: number;
  clarity: number;
  jobFit: number;
};

/** Per-dimension bullet-point evaluations grounded in resume + JD + answer content. */
export type DimensionDetails = {
  communication: string[];
  technicalDepth: string[];
  logicalThinking: string[];
  clarity: string[];
  jobFit: string[];
};

export type Feedback = {
  overallScore: number;
  dimensions: FeedbackDimensions;
  dimensionDetails: DimensionDetails;
  strengths: string[];
  improvements: string[];
  thinkingTimeFeedback: string;
};

export const DIMENSION_LABELS: Record<keyof FeedbackDimensions, string> = {
  communication: "沟通能力",
  technicalDepth: "技术深度",
  logicalThinking: "逻辑思维",
  clarity: "表达清晰度",
  jobFit: "岗位匹配度",
};

export function feedbackToRadarDims(
  dimensions: FeedbackDimensions
): { key: string; value: number }[] {
  return (Object.keys(DIMENSION_LABELS) as (keyof FeedbackDimensions)[]).map(
    (k) => ({ key: DIMENSION_LABELS[k], value: dimensions[k] })
  );
}
