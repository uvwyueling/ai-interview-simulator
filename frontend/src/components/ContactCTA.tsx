"use client";

import { useEffect, useRef, useState } from "react";
import { track, EVENTS } from "@/lib/analytics";
import { getAnonId, getSessionId } from "@/lib/identity";
import { useInterview } from "@/context/InterviewContext";

// Caps mirror the server Zod schema — over-length input is trimmed silently
// so the UX is "you can't type more" rather than a form error.
const CONTACT_MAX = 200;
const MESSAGE_MAX = 2000;

function getTz(): string {
  if (typeof Intl === "undefined") return "";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export default function ContactCTA() {
  const { contactSubmitted, markContactSubmitted } = useInterview();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const clickTrackedRef = useRef(false);
  const shownTrackedRef = useRef(false);

  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fire contact_cta_shown ONLY when the block actually enters the viewport —
  // rendering ≠ seen (feedback page is tall; users often never scroll here).
  useEffect(() => {
    if (contactSubmitted || shownTrackedRef.current) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // Fallback: no observer support → count render as a proxy for shown.
      shownTrackedRef.current = true;
      track(EVENTS.CONTACT_CTA_SHOWN);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !shownTrackedRef.current) {
            shownTrackedRef.current = true;
            track(EVENTS.CONTACT_CTA_SHOWN);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.4 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [contactSubmitted]);

  // Intent signal — clicked/focused into the input for the first time.
  const handleFocus = () => {
    if (clickTrackedRef.current) return;
    clickTrackedRef.current = true;
    track(EVENTS.CONTACT_CTA_CLICKED);
  };

  const canSubmit = !submitting && (contact.trim().length > 0 || message.trim().length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "contact",
          contact: contact.trim() || null,
          message: message.trim() || null,
          tz: getTz(),
          anonId: getAnonId(),
          sessionId: getSessionId(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "提交失败，请稍后再试");
      }
      track(EVENTS.CONTACT_SUBMITTED, {
        hasContact: contact.trim().length > 0,
        hasMessage: message.trim().length > 0,
        messageLen: message.trim().length,
      });
      markContactSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  if (contactSubmitted) {
    return (
      <div
        ref={rootRef}
        className="mt-6 rounded-2xl px-6 py-5 bg-emerald-50 ring-1 ring-emerald-200 flex items-center gap-3"
      >
        <div className="w-8 h-8 rounded-full bg-emerald-500 text-white grid place-items-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <div className="text-[14px] font-medium text-emerald-900">
            收到啦，等我联系你 🙌
          </div>
          <div className="text-[12px] text-emerald-800/80 mt-0.5">
            这杯咖啡我记下了。你的每一句真实反馈都很重要。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="mt-6 rounded-2xl px-6 py-5 bg-slate-50 ring-1 ring-slate-200"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 grid place-items-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
            <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
            <line x1="6" y1="2" x2="6" y2="4" />
            <line x1="10" y1="2" x2="10" y2="4" />
            <line x1="14" y1="2" x2="14" y2="4" />
          </svg>
        </div>
        <div className="text-[13px] leading-relaxed text-slate-700">
          这是我一个人做的 v0。如果你愿意花 20 分钟跟我聊聊哪里不好用，留个联系方式（微信 / 邮箱 / 小红书号都行），
          <span className="font-medium text-slate-900">我请你喝咖啡</span> ☕️
        </div>
      </div>

      <div className="space-y-3">
        <input
          type="text"
          value={contact}
          onChange={(e) => setContact(e.target.value.slice(0, CONTACT_MAX))}
          onFocus={handleFocus}
          placeholder="微信 / 邮箱 / 小红书号"
          className="w-full px-3.5 py-2.5 text-[13px] rounded-lg bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-400 focus:outline-none transition placeholder:text-slate-400"
          disabled={submitting}
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
          onFocus={handleFocus}
          placeholder="想吐槽什么？（可选）"
          rows={2}
          className="w-full px-3.5 py-2.5 text-[13px] rounded-lg bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-400 focus:outline-none transition placeholder:text-slate-400 resize-none"
          disabled={submitting}
        />

        {error && (
          <div className="text-[12px] text-rose-600">{error}</div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-400">
            只我一个人能看到，不会公开、不会拿去做别的用途。
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`text-[13px] font-medium px-4 py-2 rounded-lg transition flex items-center gap-1.5 shrink-0 ${
              canSubmit
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {submitting && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
            )}
            {submitting ? "提交中…" : "留个联系方式"}
          </button>
        </div>
      </div>
    </div>
  );
}
