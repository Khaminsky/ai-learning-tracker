"use client";
import { useState } from "react";
import { Coffee, Pause, Play, SkipForward, Square, Settings2, Timer, Watch } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  elapsedMs, formatClock, getTaskMeta, isRunning, type FocusMode, type FocusSettings,
} from "@/lib/focus";
import { cn } from "@/lib/utils";
import { useNow } from "./use-now";

const RADIUS = 88;
const CIRC = 2 * Math.PI * RADIUS;

const PHASE_LABEL = { work: "Focus", short_break: "Short break", long_break: "Long break" } as const;

export function FocusTimer() {
  const timer = useStore((s) => s.timer);
  const settings = useStore((s) => s.focusSettings);
  const tasks = useStore((s) => s.tasks);
  const start = useStore((s) => s.startFocus);
  const pause = useStore((s) => s.pauseFocus);
  const resume = useStore((s) => s.resumeFocus);
  const stop = useStore((s) => s.stopFocus);
  const skip = useStore((s) => s.skipPhase);
  const setTask = useStore((s) => s.setFocusTask);
  const setSettings = useStore((s) => s.setFocusSettings);

  const [pendingTask, setPendingTask] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const now = useNow(isRunning(timer));

  const running = isRunning(timer);
  const mode: FocusMode = timer?.mode ?? settings.mode;
  const phase = timer?.phase ?? "work";
  const isBreak = phase !== "work";

  const e = timer ? elapsedMs(timer, now) : 0;
  const idleTarget = settings.workMin * 60_000;
  const target = timer ? timer.targetMs : mode === "pomodoro" ? idleTarget : null;
  const shown = target !== null ? Math.max(0, target - e) : e;
  // Stopwatch has no end, so its ring fills once per hour.
  const fraction = target !== null ? Math.min(1, e / target) : (e % 3_600_000) / 3_600_000;

  const selectedTaskId = timer ? timer.taskId ?? "" : pendingTask;
  const inProgressIds = Object.entries(tasks).filter(([, t]) => t.status === "in_progress").map(([id]) => id);
  const taskOptions = Array.from(new Set([...(selectedTaskId ? [selectedTaskId] : []), ...inProgressIds]))
    .map((id) => ({ id, title: getTaskMeta(id)?.title ?? id }))
    .sort((a, b) => a.title.localeCompare(b.title));

  const onTaskChange = (id: string) => (timer ? setTask(id || null) : setPendingTask(id));

  const handleStop = () => {
    const wasWork = timer?.phase === "work";
    const secs = timer ? Math.round(elapsedMs(timer, Date.now()) / 1000) : 0;
    stop();
    if (wasWork) {
      toast(secs >= 60 ? "Session logged" : "Session under 1 minute — not logged");
    }
  };

  const num = (key: keyof FocusSettings) => (ev: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(ev.target.value, 10);
    if (!Number.isNaN(v)) setSettings({ [key]: v } as Partial<FocusSettings>);
  };

  const toggleNotifications = async () => {
    if (settings.notifications) return setSettings({ notifications: false });
    if (typeof Notification === "undefined") return toast.error("Notifications aren't supported in this browser");
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm === "granted") setSettings({ notifications: true });
    else toast.error("Notification permission was denied");
  };

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        {/* Mode switch (locked while a run is active) */}
        <div className="flex justify-center">
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
            {([
              ["pomodoro", "Pomodoro", Timer],
              ["stopwatch", "Stopwatch", Watch],
            ] as const).map(([m, label, Icon]) => (
              <button
                key={m}
                disabled={!!timer}
                onClick={() => setSettings({ mode: m })}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors disabled:cursor-not-allowed",
                  mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* Ring */}
        <div className="relative mx-auto mt-6 w-56 h-56">
          <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90" aria-hidden>
            <circle cx="100" cy="100" r={RADIUS} fill="none" strokeWidth="8" className="stroke-muted" />
            <circle
              cx="100" cy="100" r={RADIUS} fill="none" strokeWidth="8" strokeLinecap="round"
              className={cn("transition-[stroke-dashoffset] duration-500", isBreak ? "stroke-emerald-500" : "stroke-orange-500")}
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - fraction)}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
              {isBreak && <Coffee className="w-3 h-3" />}
              {mode === "stopwatch" ? "Stopwatch" : PHASE_LABEL[phase]}
              {timer && !running && " · paused"}
            </span>
            <span className="text-5xl font-semibold tabular-nums tracking-tight mt-1" role="timer" aria-live="off">
              {formatClock(shown)}
            </span>
            {mode === "pomodoro" && (
              <span className="text-xs text-muted-foreground mt-1 tabular-nums">
                {timer?.cycle ?? 0} done · long break every {settings.longBreakEvery}
              </span>
            )}
          </div>
        </div>

        {/* Task picker */}
        <div className="mt-6 max-w-sm mx-auto">
          <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5" htmlFor="focus-task">
            Working on
          </label>
          <select
            id="focus-task"
            value={selectedTaskId}
            onChange={(ev) => onTaskChange(ev.target.value)}
            className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">No task (free focus)</option>
            {taskOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          {taskOptions.length === 0 && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Tasks you mark <em>In progress</em> show up here. You can also hit Focus on any task card.
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="mt-6 flex items-center justify-center gap-2">
          {!timer ? (
            <Button size="lg" onClick={() => start(pendingTask || null)}>
              <Play /> Start {mode === "pomodoro" ? "focus" : "stopwatch"}
            </Button>
          ) : (
            <>
              <Button size="lg" onClick={running ? pause : resume}>
                {running ? <Pause /> : <Play />} {running ? "Pause" : "Resume"}
              </Button>
              {mode === "pomodoro" && (
                <Button size="lg" variant="outline" onClick={skip}>
                  <SkipForward /> Skip
                </Button>
              )}
              <Button size="lg" variant="outline" onClick={handleStop}>
                <Square /> {phase === "work" ? "Finish" : "End"}
              </Button>
            </>
          )}
        </div>

        {/* Settings */}
        <div className="mt-6 border-t border-border pt-4">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={showSettings}
          >
            <Settings2 className="w-3.5 h-3.5" /> Timer settings
          </button>
          {showSettings && (
            <div className="mt-4 space-y-4">
              <p className="text-[11px] text-muted-foreground">Durations apply from the next phase you start.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  ["workMin", "Focus (min)"],
                  ["shortBreakMin", "Short break"],
                  ["longBreakMin", "Long break"],
                  ["longBreakEvery", "Long every"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="text-xs text-muted-foreground space-y-1">
                    <span>{label}</span>
                    <Input type="number" min={1} value={settings[key]} onChange={num(key)} className="h-9 text-foreground" />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
                {([
                  ["autoStartBreaks", "Auto-start breaks"],
                  ["autoStartWork", "Auto-start next focus"],
                  ["sound", "Sound"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings[key]}
                      onChange={(ev) => setSettings({ [key]: ev.target.checked } as Partial<FocusSettings>)}
                    />
                    {label}
                  </label>
                ))}
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={settings.notifications} onChange={toggleNotifications} />
                  Browser notifications
                </label>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
