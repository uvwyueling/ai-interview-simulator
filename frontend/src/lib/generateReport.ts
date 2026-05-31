/**
 * Generates a self-contained HTML string for the interview feedback report.
 * Opened in a new window via window.open(), then window.print() saves it as PDF.
 * No external dependencies — uses only inline styles and system fonts.
 */

import type { Feedback, FeedbackDimensions, QuestionThread } from "@/types/interview";
import { DIMENSION_LABELS } from "@/types/interview";

const DIM_KEYS: (keyof FeedbackDimensions)[] = [
  "communication",
  "technicalDepth",
  "logicalThinking",
  "clarity",
  "jobFit",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function grade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 75) return "B+";
  if (score >= 65) return "B";
  return "C";
}

// ── Sub-renderers ─────────────────────────────────────────────────────────────

function dimBar(label: string, score: number): string {
  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
      <span style="width:76px;font-size:12px;color:#64748b;flex-shrink:0">${esc(label)}</span>
      <div style="flex:1;height:5px;background:#e2e8f0;border-radius:9999px;overflow:hidden">
        <div style="width:${score}%;height:100%;background:#4f46e5;border-radius:9999px"></div>
      </div>
      <span style="width:26px;text-align:right;font-size:12px;font-weight:600;color:#0f172a;font-variant-numeric:tabular-nums">${score}</span>
    </div>`;
}

function renderScoreBlock(feedback: Feedback): string {
  const bars = DIM_KEYS.map((k) => dimBar(DIMENSION_LABELS[k], feedback.dimensions[k])).join("");
  return `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:start">
      <!-- Score badge -->
      <div style="text-align:center">
        <div style="font-size:42px;font-weight:700;color:#0f172a;line-height:1;font-variant-numeric:tabular-nums">${feedback.overallScore}</div>
        <div style="font-size:11px;color:#94a3b8;margin:2px 0 8px">/100</div>
        <div style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;background:#4f46e5;color:white;font-size:17px;font-weight:700;border-radius:8px">${grade(feedback.overallScore)}</div>
      </div>
      <!-- Dimension bars -->
      <div style="padding-top:6px">${bars}</div>
    </div>`;
}

function renderBullets(items: string[], color: string, label: string): string {
  const lis = items
    .map((s) => `<li style="margin-bottom:5px;color:#374151;line-height:1.65">${esc(s)}</li>`)
    .join("");
  return `
    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:600;color:${color};margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em">${label}</div>
      <ul style="margin:0;padding-left:18px;font-size:13px">${lis}</ul>
    </div>`;
}

function renderDimDetails(feedback: Feedback): string {
  const sections = DIM_KEYS.map((k) => {
    const bullets = feedback.dimensionDetails[k]
      .map((b) => `<li style="margin-bottom:5px;color:#374151;line-height:1.65">${esc(b)}</li>`)
      .join("");
    return `
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:5px">
          ${esc(DIMENSION_LABELS[k])}
          <span style="font-family:monospace;color:#4f46e5;font-weight:700"> ${feedback.dimensions[k]}</span>
          <span style="color:#94a3b8;font-size:11px">/100</span>
        </div>
        <ul style="margin:0;padding-left:18px;font-size:12px">${bullets}</ul>
      </div>`;
  }).join("");

  return `
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid #f1f5f9">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin-bottom:12px">维度详情</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 28px">${sections}</div>
    </div>`;
}

function renderThreadConversation(thread: QuestionThread): string {
  const exchanges = thread.exchanges
    .map(
      (ex, i) => `
      <div style="margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${i === 0 ? "#4f46e5" : "#d97706"};margin-bottom:4px">
          ${i === 0 ? "主问题" : `追问 ${i}`}
        </div>
        <div style="font-size:13px;font-weight:500;color:#1e293b;margin-bottom:5px">${esc(ex.question.text)}</div>
        <div style="font-size:13px;color:#374151;background:white;border-radius:6px;padding:10px 12px;line-height:1.7;border-left:3px solid ${i === 0 ? "#4f46e5" : "#f59e0b"}">
          ${esc(ex.answer.transcript || "（未作答）")}
        </div>
      </div>`
    )
    .join("");

  return `
    <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:18px">
      ${thread.exchanges.length > 1
        ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:10px">共 ${thread.exchanges.length} 轮对话（含 ${thread.exchanges.length - 1} 次追问）</div>`
        : ""}
      ${exchanges}
    </div>`;
}

function renderQuestionSection(
  thread: QuestionThread,
  feedback: Feedback | null,
  index: number,
  addPageBreak: boolean
): string {
  const header = `
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
      <div style="width:28px;height:28px;background:#4f46e5;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:13px;font-weight:700;flex-shrink:0;margin-top:2px">${index + 1}</div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin-bottom:3px">主题 ${index + 1} · ${esc(thread.mainQuestion.category)}</div>
        <div style="font-size:15px;font-weight:600;color:#0f172a;line-height:1.4">${esc(thread.mainQuestion.text)}</div>
      </div>
    </div>`;

  const feedbackHTML = feedback
    ? `
      ${renderScoreBlock(feedback)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:18px">
        <div>${renderBullets(feedback.strengths, "#059669", "✓ 做得好的地方")}</div>
        <div>${renderBullets(feedback.improvements, "#d97706", "→ 可改进的地方")}</div>
      </div>
      ${renderDimDetails(feedback)}
      ${feedback.thinkingTimeFeedback ? `
        <div style="margin-top:14px;padding:11px 14px;background:#eff6ff;border-radius:8px;font-size:12px;color:#1e40af;line-height:1.6">
          <span style="font-weight:600">思考节奏：</span>${esc(feedback.thinkingTimeFeedback)}
        </div>` : ""}
    `
    : `<div style="padding:16px;background:#fef2f2;border-radius:8px;color:#991b1b;font-size:13px">此题反馈生成失败，请在应用中重试后重新导出。</div>`;

  return `
    <div ${addPageBreak ? 'style="page-break-before:always;padding-top:40px"' : ""}>
      <div style="padding:24px;background:white;border:1px solid #e2e8f0;border-radius:14px;margin-bottom:28px">
        ${header}
        ${renderThreadConversation(thread)}
        <div style="border-top:1px solid #f1f5f9;padding-top:18px">${feedbackHTML}</div>
      </div>
    </div>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateReportHTML(
  threads: QuestionThread[],
  feedbacks: (Feedback | null)[],
  isDemo: boolean
): string {
  const now = new Date().toLocaleString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const validFeedbacks = feedbacks.filter((f): f is Feedback => !!f);
  const avgScore =
    validFeedbacks.length > 0
      ? Math.round(
          validFeedbacks.reduce((s, f) => s + f.overallScore, 0) / validFeedbacks.length
        )
      : null;

  const bodyContent = isDemo
    ? `<div style="padding:48px 0;text-align:center;color:#94a3b8;font-size:14px;line-height:1.8">
        <div style="font-size:32px;margin-bottom:12px">📋</div>
        当前显示的是示例数据。<br>
        完成一次真实面试后导出报告，将包含基于您真实回答的专属反馈。
      </div>`
    : threads
        .map((t, i) =>
          renderQuestionSection(t, feedbacks[i] ?? null, i, i > 0)
        )
        .join("");

  const hasFollowUps = !isDemo && threads.some((t) => t.exchanges.length > 1);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AI 面试反馈报告 · ${esc(now)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, "PingFang SC", "Hiragino Sans GB",
                   "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      background: #f8fafc;
      font-size: 14px;
      line-height: 1.6;
    }
    @page { size: A4; margin: 1.8cm 2cm; }
    @media print {
      body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div style="max-width:760px;margin:0 auto;padding:32px 24px">

    <!-- Print hint (hidden when actually printing) -->
    <div class="no-print" style="margin-bottom:20px;padding:10px 16px;background:#eff6ff;border-radius:8px;font-size:13px;color:#1e40af;display:flex;align-items:center;justify-content:space-between">
      <span>按 <strong>Ctrl+P</strong>（Mac：⌘+P），然后选择"另存为 PDF"</span>
      <button onclick="window.print()" style="padding:5px 14px;background:#4f46e5;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600">打印 / 保存 PDF</button>
    </div>

    <!-- Report header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:22px;margin-bottom:28px;border-bottom:2px solid #e2e8f0">
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#4f46e5;margin-bottom:6px">AI Interview Simulator</div>
        <h1 style="font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.02em">面试反馈报告</h1>
        <div style="font-size:12px;color:#94a3b8;margin-top:5px">
          ${esc(now)}${isDemo ? " · 示例数据" : ""}
          ${!isDemo ? ` · ${(["一", "二", "三"][threads.length - 1] ?? threads.length) + "个主题"}${hasFollowUps ? " · 含追问" : ""}` : ""}
        </div>
      </div>
      ${avgScore !== null ? `
        <div style="text-align:center;flex-shrink:0">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin-bottom:4px">综合得分</div>
          <div style="font-size:44px;font-weight:700;color:#0f172a;line-height:1;font-variant-numeric:tabular-nums">${avgScore}</div>
          <div style="font-size:11px;color:#94a3b8">/100</div>
          <div style="margin-top:8px;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;background:#4f46e5;color:white;font-size:18px;font-weight:700;border-radius:9px">${grade(avgScore)}</div>
        </div>` : ""}
    </div>

    <!-- Question sections -->
    ${bodyContent}

    <!-- Footer -->
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1">
      <span>由 AI Interview Simulator 生成</span>
      <span>${esc(now)}</span>
    </div>

  </div>
</body>
</html>`;
}
