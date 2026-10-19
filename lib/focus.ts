// Focus-time tracking: types, defaults and pure helpers (no React, no store imports)
import { PLAN, IMAGE_PLAN, VIDEO_PLAN, AUDIO_PLAN } from "./data/plan";
import { SETUP_ITEMS } from "./data/setup";
import { startOfWeek } from "./utils";

export type FocusMode = "pomodoro" | "stopwatch";
export type FocusPhase = "work" | "short_break" | "long_break";

export interface FocusSession {
  id: string;
  taskId: string | null;
  mode: FocusMode;
  startedAt: string; // ISO — when the work phase began
  endedAt: string; // ISO
  durationSec: number; // focused seconds (pauses excluded)
  completed: boolean; // pomodoro ran to its target, or stopwatch hit the XP threshold
  xp: number;
}

export interface FocusSettings {
  mode: FocusMode;
  workMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number; // long break after this many pomodoros
  autoStartBreaks: boolean;
  autoStartWork: boolean;
  sound: boolean;
  notifications: boolean;
}

export interface TimerState {
  mode: FocusMode;
  phase: FocusPhase;
  taskId: string | null;
  targetMs: number | null; // null for stopwatch
  startedAt: number | null; // epoch ms of current run segment; null when paused
  accumulatedMs: number; // time banked before the current segment
  phaseStartedAt: string; // ISO — first start of this phase (for the session log)
  cycle: number; // pomodoros completed in this run
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  mode: "pomodoro",
  workMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
  autoStartBreaks: true,
  autoStartWork: false,
  sound: true,
  notifications: false,
};

/** Sessions shorter than this are discarded when stopped early. */
export const MIN_LOGGED_SEC = 60;
/** A stopwatch session counts as "completed" (XP-eligible) past this length. */
export const STOPWATCH_XP_MIN = 25;
/** XP-earning focus sessions per day, to keep XP honest. */
export const MAX_XP_SESSIONS_PER_DAY = 8;

export function elapsedMs(t: TimerState, now: number): number {
  return t.accumulatedMs + (t.startedAt !== null ? Math.max(0, now - t.startedAt) : 0);
}

export function isRunning(t: TimerState | null): boolean {
  return !!t && t.startedAt !== null;
}

export function phaseTargetMs(settings: FocusSettings, phase: FocusPhase): number {
  const min = phase === "work" ? settings.workMin : phase === "short_break" ? settings.shortBreakMin : settings.longBreakMin;
  return min * 60_000;
}

export function sanitizeSettings(raw: Partial<FocusSettings> | undefined): FocusSettings {
  const s = { ...DEFAULT_FOCUS_SETTINGS, ...raw };
  const clamp = (n: number, lo: number, hi: number, fb: number) =>
    Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fb;
  return {
    ...s,
    mode: s.mode === "stopwatch" ? "stopwatch" : "pomodoro",
    workMin: clamp(s.workMin, 1, 180, 25),
    shortBreakMin: clamp(s.shortBreakMin, 1, 60, 5),
    longBreakMin: clamp(s.longBreakMin, 1, 120, 15),
    longBreakEvery: clamp(s.longBreakEvery, 2, 12, 4),
  };
}

/** mm:ss, or h:mm:ss past an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Compact duration like "1h 20m" or "45m". */
export function formatDuration(sec: number): string {
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function localDayKey(d: Date | string | number): string {
  const x = new Date(d);
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${mm}-${dd}`;
}

/** Local-time day keys for the past n days, oldest first. */
export function lastNLocalDays(n: number, end: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    out.push(localDayKey(d));
  }
  return out;
}

// --- Task lookup (id -> title/track/estimate) ---------------------------------

export interface TaskMeta {
  title: string;
  track: "Setup" | "Main" | "Image" | "Video" | "Audio";
  estMin?: number;
}

let taskIndex: Map<string, TaskMeta> | null = null;

export function getTaskMeta(taskId: string): TaskMeta | undefined {
  if (!taskIndex) {
    taskIndex = new Map();
    const add = (plan: typeof PLAN, track: TaskMeta["track"]) =>
      plan.forEach((w) => w.tasks.forEach((t) => taskIndex!.set(t.id, { title: t.title, track, estMin: t.estMin })));
    add(PLAN, "Main");
    add(IMAGE_PLAN, "Image");
    add(VIDEO_PLAN, "Video");
    add(AUDIO_PLAN, "Audio");
    SETUP_ITEMS.forEach((s) => taskIndex!.set(s.id, { title: s.title, track: "Setup", estMin: s.estimatedMinutes }));
  }
  return taskIndex.get(taskId);
}

// --- Aggregations -------------------------------------------------------------

export function totalSecSince(sessions: FocusSession[], since: number): number {
  return sessions.reduce((sum, s) => (new Date(s.startedAt).getTime() >= since ? sum + s.durationSec : sum), 0);
}

export function secThisWeek(sessions: FocusSession[]): number {
  return totalSecSince(sessions, startOfWeek().getTime());
}

export function secToday(sessions: FocusSession[]): number {
  const key = localDayKey(new Date());
  return sessions.reduce((sum, s) => (localDayKey(s.startedAt) === key ? sum + s.durationSec : sum), 0);
}

export function secByDay(sessions: FocusSession[], days: string[]): number[] {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const k = localDayKey(s.startedAt);
    map.set(k, (map.get(k) ?? 0) + s.durationSec);
  }
  return days.map((d) => map.get(d) ?? 0);
}

export function secByTask(sessions: FocusSession[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) if (s.taskId) map.set(s.taskId, (map.get(s.taskId) ?? 0) + s.durationSec);
  return map;
}

export function secByTrack(sessions: FocusSession[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sessions) {
    const track = (s.taskId && getTaskMeta(s.taskId)?.track) || "Unassigned";
    out[track] = (out[track] ?? 0) + s.durationSec;
  }
  return out;
}
