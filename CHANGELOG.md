# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.8.5] — 2026-06-10

### Changed
- **Feedback cost optimization** (per-interview cost ~$0.25 → ~$0.20):
  - Retries on `/api/generate-feedback` reduced 3 → 2 (sonnet output is the dominant cost; retries are the worst-case multiplier)
  - Output trimmed via prompt: each dimension now asked for exactly 2 evidence bullets (was 2–3). Schema kept at max 3 ("instruct tight, validate loose") so an occasional extra bullet does NOT trigger an expensive validation-failure retry
  - Résumé + JD moved into a dedicated cached content block (`cache_control`) ahead of the volatile task content; the 3 staggered feedback calls in a session now read the ~3–4K-token résumé/JD prefix at ~10% price (calls 2 & 3 hit cache)

### Notes
- These are modest savings (~15–20%/interview). They do NOT explain the earlier $4 draw-down (that is accumulated dev-testing spend — confirm on console.anthropic.com Usage). The durable safeguard is a spend limit on the key
- The follow-up loop was deliberately left unchanged: it runs on Haiku and does not send the résumé; its growing conversation thread is volatile and inherently uncacheable, so prompt caching can't help it

---

## [0.8.4] — 2026-06-10

### Changed
- **Chrome guidance now covers PDF parsing too** — user re-test confirmed PDF parsing works in Chrome but still fails in their Safari even with the pdf.js legacy build (Safari below the legacy build's support floor). Instead of adding another standalone hint, the existing trust badge was generalized: "推荐 Chrome 桌面端：语音作答与 PDF 解析体验最佳（其他浏览器可粘贴文本、键盘作答）"
- **PDF failure error is now actionable** — "无法解析 PDF（Safari 等部分浏览器暂不支持），请改用 Chrome，或复制文字后粘贴" (Chrome users never see it; Safari users get a clear next step at the moment of failure)

---

## [0.8.3] — 2026-06-10

### Fixed
- **Wide-screen interview layout blowout** — added `min-w-0` to both grid columns. Grid `1fr` = `minmax(auto,1fr)`: the conversation-history panel's `truncate` (nowrap) text inflated the right column's min-content width, exploding it and squeezing the question card into a vertical strip on wide viewports. Verified at 2200px: columns hold the intended 1.1:1 ratio with long follow-up history present
- **PDF parsing hardened for older browsers** — switched to pdf.js **legacy build** (+ matching legacy worker). The main build requires `Promise.withResolvers` (Chrome 119+ / Safari 17.4+) and threw on older browsers, the likely cause of the production "无法解析 PDF" report (production worker serving and the parse pipeline both verified healthy). Error message now mentions outdated browsers as a cause
- **Dev-mode session restore was broken under React StrictMode** — the hydration guard was a ref; StrictMode's double effect pass made the second SAVE run see `isHydrated=true` while closing over blank default state, overwriting the stored session before the second HYDRATE re-read it. Changed the guard to React state (uncommitted in the second pass → save correctly skips). Production behavior unchanged

### Removed
- **Misleading JD hint "支持粘贴 BOSS / LinkedIn / 拉勾 链接"** (with its dashed box) — the product has no link-fetching capability; pasted URLs were treated as plain text

---

## [0.8.2] — 2026-06-09

### Added
- **Basic abuse protection** (`lib/rateLimit.ts`) — in-memory per-IP rate limiting on the API routes: a shared 40-req/min cap across the 3 LLM routes (`generate-questions/feedback/followup`) and 200/min on `/api/track`. Returns 429 with `Retry-After`. Best-effort on serverless (documented); back with Upstash/Vercel KV for hard limits at public launch
- **`/privacy` page** — honest data-use statement (résumé/JD sent to Claude but not stored, voice handled by the browser's recognition service, anonymous analytics in Supabase, no account, no training use). Linked from the input-screen privacy chip ("隐私说明")
- **First-time onboarding hint** on the interview screen's first question — one line explaining mic answering, follow-ups (max 3), and editable transcript; auto-hides after the first answer

### Notes
- Pre-beta hardening (P1). Verified against a production build

---

## [0.8.1] — 2026-06-09

### Fixed
- **DEMO step-jumper no longer ships to production** — the floating "DEMO 输入/面试/反馈" bar (a dev tool) was rendered unconditionally; real users could teleport into the mock feedback page, confusing them and polluting funnel analytics. Now gated behind `process.env.NODE_ENV !== "production"`

### Changed
- **Removed dead header UI** for beta polish: the no-op "教程" button and the fake "Z" avatar (implied a logged-in account that doesn't exist). Header is now Logo + step bar
- **Set voice/browser expectations up front** — replaced the vague "支持中英文双语面试" trust badge with "语音作答建议使用 Chrome 桌面端（其他浏览器可改用键盘输入）", since Web Speech is Chrome-only and iPhone Safari users won't get voice

### Notes
- Pre-beta cleanup (P0). Verified against a production build: no DEMO bar, clean header, browser hint present

---

## [0.8.0] — 2026-06-09

### Added
- **PDF résumé parsing** — `.pdf` uploads are now parsed in-browser via `pdfjs-dist`; extracted text fills the résumé box. Worker is self-hosted at `/public/pdf.worker.min.mjs` (no external CDN — works in mainland China). Scanned/image PDFs are detected and the user is asked to paste text. Dropzone hint and file picker updated to include PDF. Verified end-to-end (drag → parse → text)

### Fixed
- **Mid-judging refresh recovery (M3)** — refreshing while "AI 判断是否追问" was in flight left a dangling state (answer saved, no follow-up pending) that could make the user re-answer the main question. The judging logic is extracted into `runFollowUpJudgment`, and `InterviewStep` now detects this unique state on mount and resumes the judgment automatically
- **`crypto.randomUUID` fallback** — `lib/identity.ts` now degrades to a Math.random-based UUID when `crypto.randomUUID` is unavailable (non-HTTPS contexts), preventing empty `anonId` → dropped analytics events

### Changed
- **Prompt caching** — `generate-feedback` system prompt refactored to be fully static (per-call timing data moved into the user message) and marked with `cache_control: ephemeral`, so the 3 staggered feedback calls in a session reuse the cached prefix; `generate-questions` and `generate-followup` system prompts also marked cacheable. Note: real savings scale with prompt size — the feedback prompt (largest, repeated) benefits most
- Collapse the redundant spaces pdf.js inserts between glyph runs when assembling résumé text

### Removed
- Temporary `scripts/gen-demo-report.ts` (one-off PDF-report preview helper)

### Dependencies
- Added `pdfjs-dist`

---

## [0.7.0] — 2026-06-09

### Added
- **Mobile responsiveness** — all three steps (input / interview / feedback), the header, and the demo step-jumper now render cleanly on phones. Verified at 375px with **zero horizontal overflow** across every screen

### Fixed
- Hero `<h1>` overflowed the viewport on mobile (34px CJK text exceeded 375px); now `text-[26px] sm:text-[34px]` with a `sm:` line break
- Header was cramped on mobile: logo title/subtitle wrapped vertically and the "教程" label broke mid-character. Logo text is now `whitespace-nowrap`, the tutorial link is hidden below `sm`, the mobile progress bar shrinks (`w-16 sm:w-40`), and header padding tightens (`px-4 sm:px-6`)
- Demo step-jumper button labels (输入/面试/反馈) wrapped vertically on narrow widths; added `whitespace-nowrap`

### Changed
- Added a global `overflow-x: hidden` safety net on `html, body`
- Hero subtitle and privacy badge scale down one step on mobile (`text-[13px]/[11px] sm:…`)

---

## [0.6.0] — 2026-06-09

### Added
- **Guardrail instrumentation (metrics layer 3)**:
  - `followup_degraded` event — fired when the follow-up API errors/times out and the app advances without a follow-up; carries `reason` (`http_*` / `network`) and `latencyMs`. Lets us measure 追问降级率
  - `feedback_generated` event — success counterpart to `feedback_failed`, with `latencyMs` and `exchanges`. Closes the feedback funnel and captures generation latency
  - Stage latency: `latencyMs` added to `followup_triggered`, `followup_degraded`, `feedback_generated`, `feedback_failed` (questions already had it)
  - `asrChars` on `answer_submitted` — cumulative characters contributed by speech recognition; with `answerLen` it yields the 转写编辑率 (ASR-quality proxy): `1 - asrChars/answerLen`
- **Privacy notice** on the input screen — a lock-badge line under the hero: "简历内容仅用于本次生成面试题与反馈，不留存、不用于训练"

### Fixed
- **Corrected a misleading privacy claim** — the input footer previously said "数据仅本地处理，不上传", which was inaccurate (the résumé is sent server-side to the model for generation). Replaced with an honest statement: "简历仅用于本次面试生成，不留存、不用于训练"

### Changed
- `answer_submitted` `answerLen` now counts non-whitespace characters (consistent with `asrChars`)

---

## [0.5.0] — 2026-06-08

### Added
- **Quality feedback instrumentation (Phase 2)** — 👍/👎 controls on the feedback page to quantify the two second-layer metrics that matter most for an AI product:
  - **反馈认可度 (feedback approval)** — a thumbs rating under each question's feedback and under the cross-question summary ("这份反馈对你有帮助吗？")
  - **追问有用率 (follow-up usefulness)** — for any question that had follow-ups, each follow-up question is listed with its own thumbs rating ("AI 的追问是否切中要害？")
- New `feedback_rated` analytics event with `{ target: "feedback" | "followup", usefulness: 1 | -1, index, followupDepth?, isDemo }`
- Reusable `RatingButtons` component (SVG thumbs, matches the app's icon style)
- Ratings persisted in `InterviewContext` (`ratings` map, keyed e.g. `fb:0` / `fb:summary` / `fu:0:1`) with a `setRating` action

### Changed
- Ratings only fire `feedback_rated` when the value actually changes — refresh (restored ratings) and re-clicking the same choice never double-count, consistent with the v0.4.2 feedback_viewed guard

### Notes
- Analytics queries: 反馈认可度 = ratio of `usefulness=1` where `target='feedback'`; 追问有用率 = same where `target='followup'` (filter `props->>'env'='prod'` and `props->>'isDemo'='false'` for real signal)

---

## [0.4.2] — 2026-06-08

### Fixed
- **Refreshing the feedback page no longer re-generates all feedback** (H1) — feedback results are now persisted in `InterviewContext` (sessionStorage) per thread. On refresh, already-generated feedback is restored and reused; only threads without a cached result are requested. Previously a refresh re-called `/api/generate-feedback` for every question, costing extra LLM spend and making the user wait again
- **`feedback_viewed` is now counted once per interview, not on every refresh** (H3) — guarded by a persisted `feedbackViewedTracked` flag, fixing inflated funnel numbers

### Changed
- `InterviewContext` now owns `feedbacks` (per-thread results) and `feedbackViewedTracked`; both are persisted and reset on `startInterview` / `reset`. New actions: `setFeedbackAt(index, feedback)`, `markFeedbackViewed()`
- `FeedbackStep` reads feedbacks from context instead of local state; mount effect skips threads that already have a cached result and staggers only the requests it actually makes
- `TODO.md` refreshed to reflect actual progress (deploy, loading states, demo data, persistence, PDF export, analytics all done; remaining items reorganized by priority)

---

## [0.4.1] — 2026-06-08

### Added
- **Environment tag on analytics events** — `track()` now auto-injects `env: "prod" | "dev"` into every event's `props`, derived from `process.env.NODE_ENV` (zero-config, inlined at build time). Lets analytics separate real production traffic from local testing: `where props->>'env' = 'prod'`. No call-site changes; no DB migration (stored in existing `props` jsonb).

---

## [0.4.0] — 2026-06-02

### Added
- **Analytics foundation (Phase 1)** — anonymous-ID + self-hosted event sink for measuring the product funnel without an account system
- `src/lib/identity.ts` — anonymous identity: `anonId` (localStorage, persists across visits → returning-user/retention proxy) + `sessionId` (sessionStorage, per-visit → funnel analysis); SSR-guarded, silent-fail in private mode
- `src/lib/analytics.ts` — fire-and-forget `track(event, props)` client; uses `keepalive` to survive page unload; never throws, never sends PII (lengths/scores/durations/flags only)
- `src/lib/db.ts` — isolated Supabase (Postgres) data-access layer; uses server-only `SUPABASE_SERVICE_ROLE_KEY`; graceful no-op when env unset; swap-friendly if backend changes
- `POST /api/track` — validates events with Zod and inserts into Supabase; `GET /api/track` returns per-event counts for dev verification (no PII)
- Funnel instrumentation across the flow: `input_completed`, `questions_generated`, `interview_started`, `answer_submitted`, `followup_triggered`, `interview_completed`, `feedback_viewed`, `feedback_failed`, `report_exported`
- `.env.example` documenting required env vars (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)

### Notes
- New dependency: `@supabase/supabase-js`
- Privacy: analytics events carry only derived metadata — resume / JD / answer raw text is never sent
- Requires a Supabase project + `events` table + service-role key in `.env.local` (see setup steps); without them the app runs fine and tracking is a silent no-op

---

## [0.3.5] — 2026-05-30

### Added
- **PDF export** — "导出报告 PDF" button opens a print-ready HTML document in a new tab containing the full report (all questions, conversation threads, scores, dimension bars, strengths / improvements / dimension details, thinking-time note); user saves as PDF via the browser's print dialog
- `src/lib/generateReport.ts` — standalone HTML template generator; zero new npm dependencies (pure inline styles, system fonts with CJK fallback stack)
- Print hint banner in the generated report guides the user to Ctrl+P / ⌘+P with a one-click "打印 / 保存 PDF" button (hidden when actually printing via `@media print`)
- Export button shows a spinner and "生成中…" label while feedbacks are still loading; disabled until at least one feedback is ready

### Changed
- Export button is now active in demo mode (exports the mock feedback so the feature is always demonstrable)
- Report includes each question's full conversation thread (main Q + all follow-ups) so the PDF is self-contained without needing to open the app

---

## [0.3.4] — 2026-05-30

### Added
- **sessionStorage persistence for interview state** — all user-facing state (step, resume, JD, questions, in-progress exchanges, completed threads, pending follow-up question) is now written to `sessionStorage` on every change and restored on page load; refreshing mid-interview no longer loses answers
- `readSession` / `writeSession` / `clearSession` helpers in `InterviewContext` with SSR guard (`typeof window`) and silent-fail error handling for private-browsing / quota restrictions

### Changed
- `reset()` now calls `clearSession()` so starting a new interview fully wipes the previous session
- `isJudging` is deliberately **not** persisted — it is transient API-call state that cannot be resumed after a refresh; it always resets to `false`

### Notes
- Uses `sessionStorage` (not `localStorage`) — state is scoped to the current browser tab and cleared automatically when the tab is closed, preventing stale data from surfacing in future visits
- Effect ordering in `InterviewProvider` is load-bearing: the save effect is declared **before** the hydration effect so React runs it first on initial mount; at that point `isHydrated.current` is still `false`, so the save is skipped — preventing blank defaults from overwriting a valid stored session before hydration can read it

---

## [0.3.3] — 2026-05-30

### Added
- `src/lib/models.ts` — centralised model routing config; all API routes now import from here instead of hardcoding model strings

### Changed
- **Mixed-model strategy implemented**: `generate-followup` stays on `claude-haiku-4-5` (speed-critical, binary output); `generate-questions` and `generate-feedback` upgraded to `claude-sonnet-4-6` (quality-critical, main deliverable)
- `generate-questions` `max_tokens` reduced from 2048 → 1024 (sonnet is more reliable; 3-question JSON fits easily)
- `generate-feedback` `max_tokens` reduced from 3000 → 2000 (sonnet output is more concise; feedback JSON stays well under 1200 tokens in practice)

---

## [0.3.2] — 2026-05-28

### Changed
- **Feedback page grid now locks all three columns to a fixed `640px` height on `lg+` screens** so they remain visually aligned. Previously the radar (column B) would "sink" vertically because column C's tall content stretched the grid row and the radar's `flex-1 items-center` centered itself in the extra space
- **Column C (维度详情) restructured into "fixed header + scrollable body"** — the "维度详情" title now stays anchored at the top of the card while the bullet content scrolls inside. Replaces the earlier fragile `sticky / -mx-6` approach with a clean two-section flex layout
- **Column A (FeedbackCard) wrapped in a scroll container** with `lg:overflow-y-auto lg:min-h-0` so longer strengths / improvements lists scroll inside the column instead of overflowing the grid
- Column B (radar) given `lg:overflow-hidden` + `min-h-0` so the radar stays neatly framed within its column height and never pushes neighbours

### Notes
- Mobile / small screens (`< lg`) keep the natural stacked layout with no fixed heights — only desktop gets the locked grid

---

## [0.3.1] — 2026-05-28

### Changed
- **Feedback page redesigned from 2-column to 3-column layout (25 : 45 : 30)** — text feedback / radar chart / dimension details are now three independent siblings, giving each region the horizontal space it actually needs. Previously the per-dimension details sat below the radar in a shared right column, which buried the most actionable content
- Radar chart enlarged (`max-w-[400px] → 480px`) and now occupies the full vertical space of the middle column for stronger visual presence
- Dimension detail rows simplified: the redundant purple progress bar is removed; score now reads inline as `沟通能力 (82/100)`, freeing more breathing room for the bullet evidence
- Dimension detail bullets bumped from `text-[12px] → text-[13px]` to match the strengths / improvements bullets in column A — consistent reading rhythm across the page
- `ErrorCard` updated to span 3 columns (was 2) to remain full-width inside the new grid
- New loading skeleton for the dimension details column so the page no longer feels lopsided while feedbacks stream in

---

## [0.3.0] — 2026-05-28

### Added
- **Cross-question summary tab in `FeedbackStep`** — when more than one main question has been completed, a "汇总" tab is shown first by default. It aggregates per-dimension scores via averaging, merges all per-dimension bullet evaluations across questions, and deduplicates strengths / improvements to give the user a single overall capability picture
- **Per-dimension bullet evaluations** — `Feedback.dimensionDetails` now carries 2–3 grounded bullet points for each of the five dimensions (沟通能力 / 技术深度 / 逻辑思维 / 表达清晰度 / 岗位匹配度). Bullets must quote concrete answer fragments or résumé experiences and reference JD requirements — no generic platitudes
- Radar card now renders an interactive per-dimension detail list (dimension name + score + progress bar + bullet evidence) replacing the previous compact 5-column footer

### Changed
- **`/api/generate-feedback` system prompt rewritten**: removed the `modelAnswer` requirement (it was lengthy and pushed the radar below the fold), added strict instructions for the new `dimensionDetails` field, and now requires JD context for the `jobFit` dimension
- `/api/generate-feedback` request schema now requires `jd`; `FeedbackStep` updated to forward `jd` from `InterviewContext`
- `Feedback` type: `modelAnswer` removed; `dimensionDetails: DimensionDetails` added (5 keys mirroring `FeedbackDimensions`, each an array of bullet strings)
- `FeedbackCard` no longer renders the "示范回答" section — the radar chart now appears almost immediately after the page loads, addressing the perceived slowness

### Removed
- "示范回答" module from the feedback page and from the LLM output schema (token cost reduced, generation latency improved)

---

## [0.2.1] — 2026-05-28

### Added
- Prominent "示例数据 · 仅供预览" notice banner at the top of `InterviewStep` (when entered via demo jumper) and `FeedbackStep` (when no real interview has been completed) — explains that the displayed content is mock data and provides a "返回上传 →" CTA back to the input step
- `jumpToStep` action now consumed inside `InterviewStep` and `FeedbackStep` to power the banner's back-to-input button

### Changed
- Clarified the HR / first-time-visitor experience: demo previews are preserved (so reviewers can grasp the product within ~1 minute) but are now unambiguously labelled, preventing the previous risk of HR mistaking mock data for personalised AI output

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
