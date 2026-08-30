/**
 * Canonical question categories — job-neutral by design (v0.13.1).
 *
 * Shown verbatim to the user in three places (the interview-page badge, the
 * feedback tab, the exported PDF), so the vocabulary has to fit every role.
 * The previous set was hard-coded technical (技术深度 / 系统设计) and forced
 * non-technical interviews into the nearest technical-sounding bucket — a real
 * marketing question about content-health metrics came back tagged 技术深度.
 * Now mirrors DIMENSION_LABELS below, which already swapped 技术深度 for
 * 专业深度 in v0.10.0.
 *
 * `Question.category` stays a plain string rather than this union: an off-list
 * label is purely cosmetic, and failing Zod over it would burn a retry — or the
 * whole interview — for nothing. The generate-questions prompt is where the
 * constraint is applied; this is the shared reference it's written against.
 */
export const QUESTION_CATEGORIES = [
  "项目经历",
  "专业深度",
  "方案设计",
  "行为面试",
  "岗位认知",
] as const;

export type Question = {
  id: string;
  text: string;
  /** Normally one of QUESTION_CATEGORIES — advisory, see above. */
  category: string;
  difficulty: "easy" | "medium" | "hard";
};

export type Answer = {
  questionId: string;
  transcript: string;
  /**
   * Wall clock, from the question appearing to submit. Always > 0 regardless of
   * how the answer was given.
   */
  answerSeconds: number;
  /**
   * Voice only. 0 means the user TYPED — not that they spoke for zero seconds.
   *
   * The two were once a single `durationSeconds`, which let a keyboard answer
   * reach the feedback prompt as 「本题总回答时长：0 秒」 and cost real users
   * ~40 points. Keep them apart: nothing downstream may read a duration without
   * first deciding which of the two it means.
   */
  speakingSeconds: number;
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
  technicalDepth: "专业深度",
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
