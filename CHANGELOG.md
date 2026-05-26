# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] — 2026-05-26

### Added
- **Dynamic follow-up interview system** — after each answer the LLM (acting as a senior HRBP) decides in real time whether to probe deeper; up to 3 follow-ups per main question
- New API route `/api/generate-followup` — receives the full conversation thread and JD, returns `{ shouldFollowUp, followUpQuestion? }`
- `Exchange` and `QuestionThread` types in `types/interview.ts` to model multi-round Q&A chains
- Conversation history panel in `InterviewStep` showing all previous exchanges for the current topic
- "AI 判断中" animated overlay while the follow-up decision is in flight
- Follow-up depth badge (e.g. "追问 1") and per-round tip text in the interview UI
- "+N追问" badge on feedback tabs so reviewers see which topics had deeper exploration

### Changed
- Interview flow redesigned from **5 fixed questions → 3 main questions + dynamic follow-ups**
- `InterviewContext` fully refactored: state now tracks `currentMainIndex`, `currentExchanges`, `completedThreads`, `isJudging`, and `pendingFollowUpQuestion` instead of a flat `answers[]` list
- `startInterview` gains an `isDemo: boolean` parameter; demo mode skips all follow-up API calls (zero extra cost)
- `/api/generate-questions` now generates **3** questions (was 5); system prompt updated to request questions with good follow-up potential
- `/api/generate-feedback` input changed from `{ question, transcript }` to `{ mainQuestion, thread[] }` — evaluates the entire conversation chain holistically
- `FeedbackStep` now iterates over `completedThreads` instead of `answers`; each tab covers one main question's full exchange chain
- `InputStep` demo fast-path picks **3** from the preset pool (was 5)
- Progress bar label changed to "主题 X / 共 N 题"

### Fixed
- `advanceToNext` receives `finalExchanges` as a parameter to avoid stale-closure bugs when multiple state updates are batched

---

## [0.1.0] — 2026-05-25

### Added
- Resume + JD input step with drag-and-drop DOCX/TXT upload (mammoth.js parsing)
- `/api/generate-questions` — LLM generates 5 tailored interview questions with Zod validation and retry logic
- Voice recording via Web Speech API (`SpeechRecognition`) with live interim transcript and editable textarea after recording
- Thinking-time and speaking-time tracking per question
- `/api/generate-feedback` — per-question AI feedback with STAR model answer, 5-dimension radar chart, and personalised thinking-time commentary
- `FeedbackStep` with parallel staggered API calls (1.2 s offset), per-question tabs, skeleton loaders, and retry on error
- Browser compatibility warning banner for Safari / Firefox (Web Speech API unsupported)
- Demo fast-path: when both inputs are sample data the app skips the API and picks from a preset question pool
- Demo step-jumper toolbar (fixed bottom bar) for development
