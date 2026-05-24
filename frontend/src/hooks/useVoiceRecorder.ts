"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export type UseVoiceRecorderReturn = {
  transcript: string;
  interimTranscript: string;
  thinkingTime: number;
  speakingTime: number;
  isListening: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  reset: () => void;
  error: string;
};

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState("");
  const [thinkingTime, setThinkingTime] = useState(0);
  const [speakingTime, setSpeakingTime] = useState(0);

  const questionStartRef = useRef<number>(Date.now());
  const recordingStartRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Tick speaking time every 100ms while listening
  useEffect(() => {
    if (!isListening || recordingStartRef.current === null) return;
    const id = setInterval(() => {
      setSpeakingTime(Date.now() - recordingStartRef.current!);
    }, 100);
    return () => clearInterval(id);
  }, [isListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const startRecording = useCallback(() => {
    setError("");

    const SpeechRecognitionClass =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

    if (!SpeechRecognitionClass) {
      setError("您的浏览器不支持语音识别，请使用 Chrome 或 Edge");
      return;
    }

    const now = Date.now();
    // Thinking time = gap between question shown and mic clicked
    setThinkingTime(now - questionStartRef.current);
    recordingStartRef.current = now;

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
        } else {
          interimText += event.results[i][0].transcript;
        }
      }
      if (finalText) setTranscript((prev) => prev + finalText);
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: Event) => {
      const errorType = (event as { error?: string }).error;
      if (errorType && errorType !== "aborted" && errorType !== "no-speech") {
        setError("语音识别出错，请重试");
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      // Auto-restart keeps listening until user explicitly stops
      if (recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          setIsListening(false);
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, []);

  const stopRecording = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.stop();

    setInterimTranscript("");
    setIsListening(false);
    if (recordingStartRef.current !== null) {
      setSpeakingTime(Date.now() - recordingStartRef.current);
    }
  }, []);

  const reset = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.abort();

    setTranscript("");
    setInterimTranscript("");
    setIsListening(false);
    setError("");
    setThinkingTime(0);
    setSpeakingTime(0);
    questionStartRef.current = Date.now();
    recordingStartRef.current = null;
  }, []);

  return {
    transcript,
    interimTranscript,
    thinkingTime,
    speakingTime,
    isListening,
    startRecording,
    stopRecording,
    reset,
    error,
  };
}
