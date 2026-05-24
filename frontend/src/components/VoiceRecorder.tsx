"use client";

import { useEffect } from "react";
import { Mic, MicOff } from "lucide-react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type Props = {
  onTranscriptChange?: (full: string) => void;
  onStop?: (transcript: string, thinkingTime: number, speakingTime: number) => void;
};

export default function VoiceRecorder({ onTranscriptChange, onStop }: Props) {
  const {
    transcript,
    interimTranscript,
    thinkingTime,
    speakingTime,
    isListening,
    startRecording,
    stopRecording,
    error,
  } = useVoiceRecorder();

  useEffect(() => {
    onTranscriptChange?.(transcript + interimTranscript);
  }, [transcript, interimTranscript, onTranscriptChange]);

  const handleToggle = () => {
    if (isListening) {
      stopRecording();
      onStop?.(transcript + interimTranscript, thinkingTime, speakingTime);
    } else {
      startRecording();
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Mic button with pulse rings */}
      <div className="relative flex items-center justify-center">
        {isListening && (
          <>
            <div className="absolute w-32 h-32 rounded-full bg-rose-400 animate-pulse opacity-20"></div>
            <div
              className="absolute w-40 h-40 rounded-full bg-rose-400 animate-pulse opacity-10"
              style={{ animationDelay: "0.4s" }}
            ></div>
          </>
        )}
        <button
          onClick={handleToggle}
          aria-label={isListening ? "停止录音" : "开始录音"}
          className={`relative z-10 w-24 h-24 rounded-full grid place-items-center text-white shadow-lg transition-all duration-200
            ${isListening
              ? "bg-rose-500 hover:bg-rose-600 scale-105"
              : "bg-indigo-600 hover:bg-indigo-700 hover:scale-105"
            }`}
        >
          {isListening ? (
            <MicOff className="w-10 h-10" />
          ) : (
            <Mic className="w-10 h-10" />
          )}
        </button>
      </div>

      {/* Status */}
      <p className="text-[13px] text-center min-h-[20px]">
        {error ? (
          <span className="text-rose-500">{error}</span>
        ) : isListening ? (
          <span className="text-rose-500 font-medium">
            ● 正在录音 · 点击停止
          </span>
        ) : transcript ? (
          <span className="text-slate-400">录音已停止</span>
        ) : (
          <span className="text-slate-400">点击麦克风开始录音</span>
        )}
      </p>

      {/* Timers */}
      <div className="flex items-center gap-8">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">
            思考时间
          </div>
          <div className="text-[22px] font-mono font-medium tabular-nums text-slate-700">
            {thinkingTime > 0 ? formatMs(thinkingTime) : "--:--"}
          </div>
        </div>

        <div className="w-px h-10 bg-slate-200"></div>

        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">
            回答时长
          </div>
          <div
            className={`text-[22px] font-mono font-medium tabular-nums transition-colors
              ${isListening ? "text-rose-500" : speakingTime > 0 ? "text-slate-700" : "text-slate-300"}`}
          >
            {formatMs(speakingTime)}
          </div>
        </div>
      </div>

      {/* Live transcript */}
      {(transcript || interimTranscript) && (
        <div className="w-full bg-slate-50 rounded-xl px-4 py-3 text-[14px] leading-[1.8] text-slate-700 max-h-[200px] overflow-auto scroll">
          <span>{transcript}</span>
          {interimTranscript && (
            <span className="text-indigo-500 bg-indigo-50 rounded px-0.5 ml-0.5">
              {interimTranscript}
              <span className="caret">|</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
