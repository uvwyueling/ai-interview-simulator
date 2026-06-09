"use client";

import { useState, useRef } from "react";
import { useInterview } from "@/context/InterviewContext";
import type { Question } from "@/types/interview";
import { track, EVENTS } from "@/lib/analytics";

const SAMPLE_RESUME = `张同学  ·  应届硕士
教育: 计算机科学硕士, 2024
经历: ByteSpark 实习 (前端工程师, 6个月)
      Hackday 一等奖 — 实时协作白板
技能: React, TypeScript, Node.js, Python, 图算法`;

const SAMPLE_JD = `资深前端工程师 · 上海
我们正在寻找一位对产品有热情的前端工程师, 负责核心编辑器模块。
要求:
- 3+ 年 React 经验, 熟悉性能优化
- 有复杂状态管理 / 协作编辑经验优先
- 优秀的沟通与跨团队协作能力`;

// ── Demo preset questions (shown when both inputs are sample data) ────────────
// Prefixes Q/数字/冒号 already stripped per product requirement.

const DEMO_POOL: Omit<Question, "id">[] = [
  {
    text: "在 Hackday 实时协作白板项目中，你们如何处理多用户并发编辑时的冲突解决？具体采用了什么算法（如 OT、CRDT），为什么选择这个方案而不是其他方案？",
    category: "项目经历",
    difficulty: "hard",
  },
  {
    text: "你提到掌握图算法，请结合实际项目经验说明如何使用图论知识优化白板中元素之间的关系处理或渲染性能？",
    category: "技术深度",
    difficulty: "hard",
  },
  {
    text: "ByteSpark 实习期间，你在 React 项目中遇到过最复杂的性能问题是什么？从识别问题、分析瓶颈到最终优化，整个过程是怎样的？性能提升的数据是多少？",
    category: "项目经历",
    difficulty: "medium",
  },
  {
    text: "对于一个复杂的编辑器产品，你会如何选择和设计状态管理方案？请对比 Redux、Zustand、MobX 等方案在协作编辑场景下的优劣，以及你会如何架构来支持高频的状态更新和撤销/重做功能。",
    category: "系统设计",
    difficulty: "hard",
  },
  {
    text: "作为应届硕士直接应聘资深岗位，你认为自己在经验上的差距主要在哪些方面？你计划如何在短期内弥补这些差距，同时如何与资深工程师有效协作？",
    category: "行为面试",
    difficulty: "medium",
  },
  {
    text: "假设要开发一个在线代码编辑器的核心编辑模块，需要支持实时多人协作、高性能渲染和复杂的撤销/重做栈。请说明你会如何设计整体架构，状态管理方案选择，以及前后端如何协作。",
    category: "系统设计",
    difficulty: "hard",
  },
];

function pickThree(pool: Omit<Question, "id">[]): Question[] {
  return [...pool]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

export default function InputStep() {
  const { startInterview } = useInterview();
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    setFileName(file.name);
    setError("");

    if (ext === "txt") {
      const text = await file.text();
      setResume(text.trim());
      return;
    }

    if (ext === "docx") {
      setFileLoading(true);
      try {
        const mammoth = await import("mammoth");
        const buf = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        setResume(result.value.trim());
      } catch {
        setError("无法解析 Word 文档，请复制内容后手动粘贴到文本框");
        setFileName("");
      } finally {
        setFileLoading(false);
      }
      return;
    }

    if (ext === "pdf") {
      setError("暂不支持 PDF 直接解析，请打开 PDF 复制文字后粘贴到文本框");
      setFileName("");
      return;
    }

    setError("不支持此格式，请使用 TXT / DOCX，或直接粘贴文字");
    setFileName("");
  };

  const ready = resume.trim().length > 20 && jd.trim().length > 20;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  };

  const handleGenerate = async () => {
    if (!ready || loading) return;
    setError("");

    // Demo fast-path: both inputs are unmodified sample data → skip API call
    if (resume === SAMPLE_RESUME && jd === SAMPLE_JD) {
      track(EVENTS.INPUT_COMPLETED, { isDemo: true, resumeLen: resume.length, jdLen: jd.length });
      startInterview(pickThree(DEMO_POOL), resume, jd, true);
      return;
    }

    // Normal path: call the API
    track(EVENTS.INPUT_COMPLETED, { isDemo: false, resumeLen: resume.length, jdLen: jd.length });
    setLoading(true);
    const startedAt = Date.now();
    try {
      const res = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, jd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "生成失败，请重试");
        return;
      }
      track(EVENTS.QUESTIONS_GENERATED, {
        count: data.questions?.length ?? 0,
        latencyMs: Date.now() - startedAt,
      });
      startInterview(data.questions, resume, jd, false);
    } catch {
      setError("网络错误，请检查连接后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="fade-up max-w-[1240px] mx-auto px-6 lg:px-10 pt-12 pb-24">
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-indigo-600 mb-3">
          <span className="w-1 h-1 rounded-full bg-indigo-600"></span> Step 01 /
          Prepare
        </div>
        <h1 className="text-[34px] leading-[1.15] font-semibold tracking-tight text-slate-900">
          告诉我们 <span className="text-indigo-600">你是谁</span>，
          <br className="md:hidden" />
          以及你想成为
          <span className="text-indigo-600"> 什么样的人</span>。
        </h1>
        <p className="mt-3 text-[14px] text-slate-500 max-w-xl mx-auto">
          上传简历和岗位 JD，AI 将生成 3 道核心面试题，并根据你的回答实时追问（最多 3 次），模拟真实深度面试体验。
        </p>
        <div className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-slate-400 bg-slate-100/70 rounded-full px-3 py-1.5">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>简历内容仅用于本次生成面试题与反馈，<span className="text-slate-500 font-medium">不留存、不用于训练</span></span>
        </div>
      </div>

      {error && (
        <div className="max-w-md mx-auto mb-6 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-[13px] text-rose-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-stretch">
        {/* Resume */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 grid place-items-center text-indigo-600">
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <path d="M14 3v6h6" />
                </svg>
              </div>
              <div>
                <div className="text-[14px] font-medium">你的简历</div>
                <div className="text-[11px] text-slate-400">
                  PDF / DOCX / 直接粘贴文本
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setResume(SAMPLE_RESUME);
                setFileName("");
              }}
              className="text-[11px] text-slate-400 hover:text-indigo-600 transition"
            >
              试用示例
            </button>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border border-dashed border-slate-200 rounded-xl px-4 py-3 mb-3 flex items-center justify-between gap-3 hover:border-indigo-400 hover:bg-indigo-50/30 transition cursor-pointer"
          >
            <div className="flex items-center gap-2 text-[12px] text-slate-500">
              {fileLoading ? (
                <svg className="w-4 h-4 text-indigo-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 3a9 9 0 1 0 9 9" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
              {fileLoading ? (
                <span className="text-indigo-500">正在解析文件…</span>
              ) : fileName ? (
                <span className="text-slate-700 font-medium">{fileName}</span>
              ) : (
                "拖拽 TXT / DOCX 到此 · 或"
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[12px] font-medium text-indigo-600 hover:text-indigo-700"
            >
              选择文件
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.docx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processFile(f);
                e.target.value = "";
              }}
            />
          </div>

          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            placeholder="…或者直接在这里粘贴你的简历文本"
            className="flex-1 min-h-[200px] resize-none text-[13px] leading-[1.7] text-slate-700 placeholder-slate-300 bg-slate-50/60 rounded-xl px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/40 transition"
          />

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>{resume.length} chars</span>
            <span className={resume.length > 20 ? "text-emerald-600" : ""}>
              {resume.length > 20 ? "✓ 已识别" : "至少 20 字"}
            </span>
          </div>
        </div>

        {/* Center generate button */}
        <div className="flex lg:flex-col items-center justify-center gap-4 py-4">
          <div className="hidden lg:block w-px h-12 bg-gradient-to-b from-transparent to-slate-200"></div>
          <button
            onClick={handleGenerate}
            disabled={!ready || loading}
            className={`relative w-32 h-32 rounded-full flex flex-col items-center justify-center text-white transition-all
              ${ready ? "bg-indigo-600 hover:bg-indigo-700 hover:scale-[1.03] ring-soft" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
          >
            {ready && (
              <div className="absolute inset-0 rounded-full ring-4 ring-indigo-600/20"></div>
            )}
            {loading ? (
              <>
                <svg
                  className="w-7 h-7 animate-spin mb-1"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M12 3a9 9 0 1 0 9 9" />
                </svg>
                <span className="text-[11px] font-medium">生成中</span>
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  className="w-7 h-7 mb-1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z" />
                </svg>
                <span className="text-[12px] font-semibold tracking-wide">
                  生成面试问题
                </span>
                <span className="text-[10px] opacity-70 mt-0.5">
                  {ready ? "已就绪" : "请先填写"}
                </span>
              </>
            )}
          </button>
          <div className="hidden lg:block w-px h-12 bg-gradient-to-t from-transparent to-slate-200"></div>
        </div>

        {/* JD */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 ring-soft p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 grid place-items-center text-indigo-600">
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </div>
              <div>
                <div className="text-[14px] font-medium">岗位 JD</div>
                <div className="text-[11px] text-slate-400">
                  粘贴目标岗位的职位描述
                </div>
              </div>
            </div>
            <button
              onClick={() => setJd(SAMPLE_JD)}
              className="text-[11px] text-slate-400 hover:text-indigo-600 transition"
            >
              试用示例
            </button>
          </div>

          <div className="border border-dashed border-slate-200 rounded-xl px-4 py-3 mb-3 flex items-center gap-2 text-[12px] text-slate-500">
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>支持粘贴 BOSS / LinkedIn / 拉勾 链接</span>
          </div>

          <textarea
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="粘贴岗位的职责、要求、技术栈…"
            className="flex-1 min-h-[200px] resize-none text-[13px] leading-[1.7] text-slate-700 placeholder-slate-300 bg-slate-50/60 rounded-xl px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/40 transition"
          />

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>{jd.length} chars</span>
            <span className={jd.length > 20 ? "text-emerald-600" : ""}>
              {jd.length > 20 ? "✓ 已识别" : "至少 20 字"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-[12px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>{" "}
          平均生成时长 8 秒
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>{" "}
          简历仅用于本次面试生成，不留存、不用于训练
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>{" "}
          支持中英文双语面试
        </div>
      </div>
    </section>
  );
}
