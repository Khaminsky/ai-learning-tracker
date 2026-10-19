"use client";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { elapsedMs, formatClock, getTaskMeta, isRunning } from "@/lib/focus";

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.2);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* audio is best-effort */
  }
}

/**
 * Mounted once in the layout. Completes pomodoro phases when they hit their
 * target (also after a reload or sleep, since timing uses timestamps) and keeps
 * the tab title in sync so the timer is visible from other tabs.
 */
export function FocusEngine() {
  const hydrated = useStore((s) => s.hydrated);
  const timer = useStore((s) => s.timer);
  const baseTitle = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const tick = () => {
      const { timer: t, focusSettings, completePhase } = useStore.getState();
      if (!t || !isRunning(t)) return;
      if (t.mode === "pomodoro" && t.targetMs !== null && elapsedMs(t, Date.now()) >= t.targetMs) {
        const wasWork = t.phase === "work";
        const task = t.taskId ? getTaskMeta(t.taskId)?.title : undefined;
        completePhase();
        const msg = wasWork ? "Focus session complete — take a break." : "Break over — ready to focus?";
        toast.success(msg, task ? { description: task } : undefined);
        if (focusSettings.sound) beep();
        if (focusSettings.notifications && typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(msg, { body: task });
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [hydrated]);

  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title;
    if (!timer || !isRunning(timer)) {
      document.title = baseTitle.current;
      return;
    }
    const update = () => {
      const t = useStore.getState().timer;
      if (!t) return;
      const e = elapsedMs(t, Date.now());
      const shown = t.targetMs !== null ? t.targetMs - e : e;
      document.title = `${formatClock(shown)} · ${t.phase === "work" ? "Focus" : "Break"}`;
    };
    update();
    const id = setInterval(update, 1000);
    return () => {
      clearInterval(id);
      if (baseTitle.current) document.title = baseTitle.current;
    };
  }, [timer]);

  return null;
}
