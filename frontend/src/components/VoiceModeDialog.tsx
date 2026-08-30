"use client";

/**
 * Speech-mode choice, shown once before the first answer and reachable later
 * from the 「语音设置」 chip.
 *
 * ─── Hard requirement ──────────────────────────────────────────────────────
 * This file must NEVER reference getUserMedia, MediaRecorder,
 * navigator.mediaDevices, or @/lib/voice/capture.
 *
 * The browser's microphone prompt is a SEPARATE, LATER event, owned solely by
 * the mic button. Stacking a product dialog and an OS permission prompt puts two
 * authorisation contexts on screen at once, and the analytics already show one
 * user denying mic access outright. Ask what they want here; ask the browser for
 * permission only when they actually press record.
 *
 * Portalled to <body> like SampleReportModal: InterviewStep's root <section>
 * carries `.fade-up`, whose `animation-fill-mode: both` leaves a transform on
 * the element permanently, and a transformed ancestor becomes the containing
 * block for `position: fixed` children (v0.13.0 shipped that bug once already).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { VoiceMode } from "@/lib/voiceMode";

type Props = {
  /** Whether the server actually has a provider — from GET /api/transcribe, never a build flag. */
  cloudAvailable: boolean;
  initialMode: VoiceMode;
  source: "first_run" | "settings";
  onConfirm: (mode: VoiceMode) => void;
  /** Escape / backdrop. First run has no dismiss — a choice is required. */
  onDismiss?: () => void;
};

function CheckDot({ checked }: { checked: boolean }) {
  return (
    <span
      className={`mt-0.5 w-4 h-4 rounded-full shrink-0 grid place-items-center ring-1 transition ${
        checked ? "bg-indigo-600 ring-indigo-600" : "bg-white ring-slate-300"
      }`}
    >
      {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
    </span>
  );
}

export default function VoiceModeDialog({
  cloudAvailable,
  initialMode,
  source,
  onConfirm,
  onDismiss,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<VoiceMode>(
    initialMode === "cloud" && !cloudAvailable ? "browser" : initialMode
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!onDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="选择语音转文字方式"
    >
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onDismiss}
      />

      <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-[17px] font-semibold text-slate-900">
            选择语音转文字方式
          </h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            两种方式都可以随时在面试页切换。
          </p>
        </div>

        <div className="px-6 space-y-3">
          {/* High accuracy */}
          <button
            type="button"
            disabled={!cloudAvailable}
            onClick={() => setChoice("cloud")}
            className={`w-full text-left rounded-xl ring-1 p-4 transition ${
              !cloudAvailable
                ? "ring-slate-200 bg-slate-50 opacity-60 cursor-not-allowed"
                : choice === "cloud"
                  ? "ring-2 ring-indigo-500 bg-indigo-50/40"
                  : "ring-slate-200 hover:ring-indigo-300"
            }`}
          >
            <div className="flex gap-3">
              <CheckDot checked={choice === "cloud"} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-medium text-slate-900">
                    高准确转写
                  </span>
                  {!cloudAvailable && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                      暂未开放
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
                  识别中文里夹的英文、数字和专业名词更稳定。
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                  在浏览器识别之外，<span className="text-slate-700">额外</span>把一份压缩音频上传给
                  <span className="text-slate-700">科大讯飞</span>的转写服务。
                  <span className="text-slate-700">本产品不保存这份音频</span>，但它会存放在讯飞的服务器上，
                  转写结果在其侧保留 7 天。详见
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-slate-700"
                  >
                    隐私说明
                  </a>
                  。
                </p>
              </div>
            </div>
          </button>

          {/* Browser only */}
          <button
            type="button"
            onClick={() => setChoice("browser")}
            className={`w-full text-left rounded-xl ring-1 p-4 transition ${
              choice === "browser"
                ? "ring-2 ring-indigo-500 bg-indigo-50/40"
                : "ring-slate-200 hover:ring-indigo-300"
            }`}
          >
            <div className="flex gap-3">
              <CheckDot checked={choice === "browser"} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-slate-900">
                    仅浏览器转写
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                    默认
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
                  音频由浏览器内置的识别服务处理（Chrome 会发给 Google），
                  <span className="text-slate-700">不发送给 Echo Interview</span>。
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                  速度快，但中文夹英文和专业词汇可能需要更多手动修改。
                </p>
              </div>
            </div>
          </button>
        </div>

        <div className="px-6 pt-4 pb-6 mt-2 flex items-center gap-3">
          <a
            href="/privacy"
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-slate-400 hover:text-indigo-600 underline underline-offset-2"
          >
            隐私说明
          </a>
          <button
            onClick={() => onConfirm(choice)}
            className="ml-auto text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 rounded-lg transition"
          >
            {source === "first_run" ? "确认并开始面试" : "保存"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
