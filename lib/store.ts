// Zustand store with localStorage persistence + optional Supabase sync
"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { XP_VALUES, type XpReason, levelFromXp } from "./xp-engine";
import { todayKey, daysBetween } from "./utils";
import { getSupabase, isSupabaseEnabled } from "./supabase";
import {
  DEFAULT_FOCUS_SETTINGS, MAX_XP_SESSIONS_PER_DAY, MIN_LOGGED_SEC, STOPWATCH_XP_MIN,
  elapsedMs, localDayKey, phaseTargetMs, sanitizeSettings,
  type FocusSession, type FocusSettings, type TimerState,
} from "./focus";

export type TaskStatus = "not_started" | "in_progress" | "done" | "mastered";

interface TaskState {
  status: TaskStatus;
  notes?: string;
  completedAt?: string;
  confidence?: number; // 0-100
}

interface XpLogEntry {
  id: string;
  reason: XpReason;
  amount: number;
  context: string;
  at: string;
}

export interface WeeklyReview {
  id: string;
  weekKey: string; // ISO week key like "2026-W19"
  at: string;
  wins: string;
  gaps: string;
  nextWeek: string;
  energy: number; // 1-5
  rating: number; // 1-5 self-rated week quality
}

interface AppState {
  // Identity
  userId: string | null;
  email: string | null;

  // Progress
  xp: number;
  tasks: Record<string, TaskState>;
  badges: string[]; // earned badge IDs
  lastActiveDate: string | null;
  streakDays: number;
  longestStreak: number;
  xpLog: XpLogEntry[];

  // Goals
  weeklyGoalHours: number;
  weeklyReviews: WeeklyReview[];

  // Focus time tracking
  focusSessions: FocusSession[];
  focusSettings: FocusSettings;
  timer: TimerState | null; // null = idle

  // UI
  hydrated: boolean;

  // Actions
  setUser: (userId: string | null, email: string | null) => void;
  setTaskStatus: (taskId: string, status: TaskStatus, xpReason?: XpReason, context?: string) => void;
  setTaskNotes: (taskId: string, notes: string) => void;
  setTaskConfidence: (taskId: string, confidence: number) => void;
  addXp: (reason: XpReason, context: string, amountOverride?: number) => void;
  earnBadge: (badgeId: string) => void;
  checkIn: () => void; // daily check-in
  setWeeklyGoal: (hours: number) => void;
  saveWeeklyReview: (review: Omit<WeeklyReview, "id" | "at">) => void;
  startFocus: (taskId?: string | null) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  stopFocus: () => void; // ends the run, logging work done so far
  skipPhase: () => void; // pomodoro: finish the current phase now
  completePhase: () => void; // called by the engine when a pomodoro phase hits its target
  setFocusTask: (taskId: string | null) => void;
  setFocusSettings: (patch: Partial<FocusSettings>) => void;
  deleteFocusSession: (id: string) => void;
  resetAll: () => void;
  exportJson: () => string;
  importJson: (raw: string) => boolean;
}

const initialState = {
  userId: null,
  email: null,
  xp: 0,
  tasks: {},
  badges: [],
  lastActiveDate: null,
  streakDays: 0,
  longestStreak: 0,
  xpLog: [],
  weeklyGoalHours: 10,
  weeklyReviews: [] as WeeklyReview[],
  focusSessions: [] as FocusSession[],
  focusSettings: DEFAULT_FOCUS_SETTINGS,
  timer: null as TimerState | null,
  hydrated: false,
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      // Appends a work session to the log (and awards capped XP when `completed`).
      const logFocusSession = (t: TimerState, now: number, completed: boolean) => {
        const durationSec = Math.round(Math.min(elapsedMs(t, now), t.targetMs ?? Infinity) / 1000);
        const isStopwatch = t.mode === "stopwatch";
        const earned = isStopwatch ? durationSec >= STOPWATCH_XP_MIN * 60 : completed;
        if (durationSec < MIN_LOGGED_SEC) return;
        const today = localDayKey(now);
        const xpToday = get().focusSessions.filter((f) => f.xp > 0 && localDayKey(f.startedAt) === today).length;
        const xp = earned && xpToday < MAX_XP_SESSIONS_PER_DAY ? XP_VALUES.focus_session : 0;
        const entry: FocusSession = {
          id: crypto.randomUUID(),
          taskId: t.taskId,
          mode: t.mode,
          startedAt: t.phaseStartedAt,
          endedAt: new Date(now).toISOString(),
          durationSec,
          completed: earned,
          xp,
        };
        set((s) => ({ focusSessions: [entry, ...s.focusSessions].slice(0, 2000) }));
        if (xp > 0) {
          const title = t.taskId ? t.taskId : "Free focus";
          get().addXp("focus_session", `Focus session · ${title}`, xp);
        }
      };

      // Pomodoro: close the current phase and queue (or start) the next one.
      const advancePhase = (t: TimerState, now: number, completed: boolean) => {
        const settings = get().focusSettings;
        let cycle = t.cycle;
        let next: TimerState["phase"];
        if (t.phase === "work") {
          logFocusSession(t, now, completed);
          if (completed) cycle += 1;
          next = cycle > 0 && cycle % settings.longBreakEvery === 0 && completed ? "long_break" : "short_break";
        } else {
          next = "work";
        }
        const auto = next === "work" ? settings.autoStartWork : settings.autoStartBreaks;
        set({
          timer: {
            ...t,
            phase: next,
            targetMs: phaseTargetMs(settings, next),
            startedAt: auto ? now : null,
            accumulatedMs: 0,
            phaseStartedAt: new Date(now).toISOString(),
            cycle,
          },
        });
      };

      return {
      ...initialState,

      setUser: (userId, email) => set({ userId, email }),

      setTaskStatus: (taskId, status, xpReason, context) => {
        const prev = get().tasks[taskId];
        const newTask: TaskState = {
          ...prev,
          status,
          completedAt: status === "done" || status === "mastered" ? new Date().toISOString() : prev?.completedAt,
        };
        set((s) => ({ tasks: { ...s.tasks, [taskId]: newTask } }));

        // Award XP only on first transition to done/mastered
        if ((status === "done" || status === "mastered") && prev?.status !== "done" && prev?.status !== "mastered") {
          if (xpReason) get().addXp(xpReason, context ?? taskId);
        }
        // Trigger daily check-in
        get().checkIn();
      },

      setTaskNotes: (taskId, notes) => {
        set((s) => ({ tasks: { ...s.tasks, [taskId]: { ...(s.tasks[taskId] ?? { status: "not_started" as TaskStatus }), notes } } }));
      },

      setTaskConfidence: (taskId, confidence) => {
        set((s) => ({ tasks: { ...s.tasks, [taskId]: { ...(s.tasks[taskId] ?? { status: "not_started" as TaskStatus }), confidence } } }));
      },

      addXp: (reason, context, amountOverride) => {
        const amount = amountOverride ?? XP_VALUES[reason];
        const entry: XpLogEntry = {
          id: crypto.randomUUID(),
          reason,
          amount,
          context,
          at: new Date().toISOString(),
        };
        set((s) => ({ xp: s.xp + amount, xpLog: [entry, ...s.xpLog].slice(0, 500) }));
      },

      earnBadge: (badgeId) => {
        set((s) => (s.badges.includes(badgeId) ? s : { badges: [...s.badges, badgeId] }));
      },

      checkIn: () => {
        const today = todayKey();
        const last = get().lastActiveDate;
        if (last === today) return; // already checked in
        let newStreak = 1;
        if (last) {
          const gap = daysBetween(last, today);
          if (gap === 1) newStreak = get().streakDays + 1;
          else if (gap === 0) newStreak = get().streakDays;
          else newStreak = 1;
        }
        const longest = Math.max(get().longestStreak, newStreak);
        set({ lastActiveDate: today, streakDays: newStreak, longestStreak: longest });
        // award small XP for daily check-in
        if (last !== today) {
          get().addXp("daily_checkin", "Daily check-in");
        }
      },

      setWeeklyGoal: (hours) => set({ weeklyGoalHours: Math.max(1, Math.min(60, Math.round(hours))) }),

      saveWeeklyReview: (review) => {
        const entry: WeeklyReview = {
          ...review,
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
        };
        set((s) => ({ weeklyReviews: [entry, ...s.weeklyReviews].slice(0, 200) }));
        // Award XP for reflection
        get().addXp("weekly_capstone", `Weekly review · ${review.weekKey}`);
      },


      startFocus: (taskId = null) => {
        const settings = get().focusSettings;
        const now = Date.now();
        const pomodoro = settings.mode === "pomodoro";
        set({
          timer: {
            mode: settings.mode,
            phase: "work",
            taskId,
            targetMs: pomodoro ? phaseTargetMs(settings, "work") : null,
            startedAt: now,
            accumulatedMs: 0,
            phaseStartedAt: new Date(now).toISOString(),
            cycle: 0,
          },
        });
        get().checkIn();
      },

      pauseFocus: () => {
        const t = get().timer;
        if (!t || t.startedAt === null) return;
        const now = Date.now();
        set({ timer: { ...t, accumulatedMs: elapsedMs(t, now), startedAt: null } });
      },

      resumeFocus: () => {
        const t = get().timer;
        if (!t || t.startedAt !== null) return;
        const now = Date.now();
        set({
          timer: {
            ...t,
            startedAt: now,
            // first start of a phase that was queued without auto-start
            phaseStartedAt: t.accumulatedMs === 0 ? new Date(now).toISOString() : t.phaseStartedAt,
          },
        });
      },

      stopFocus: () => {
        const t = get().timer;
        if (!t) return;
        if (t.phase === "work") logFocusSession(t, Date.now(), false);
        set({ timer: null });
      },

      skipPhase: () => {
        const t = get().timer;
        if (!t || t.mode !== "pomodoro") return;
        // Skipping a work phase logs what was done (no XP); skipping a break just moves on.
        advancePhase(t, Date.now(), false);
      },

      completePhase: () => {
        const t = get().timer;
        if (!t || t.mode !== "pomodoro") return;
        advancePhase(t, Date.now(), true);
      },

      setFocusTask: (taskId) => {
        const t = get().timer;
        if (t) set({ timer: { ...t, taskId } });
      },

      setFocusSettings: (patch) =>
        set((s) => ({ focusSettings: sanitizeSettings({ ...s.focusSettings, ...patch }) })),

      deleteFocusSession: (id) =>
        set((s) => ({ focusSessions: s.focusSessions.filter((f) => f.id !== id) })),

      resetAll: () => set({ ...initialState, hydrated: true }),

      exportJson: () => {
        const { xp, tasks, badges, lastActiveDate, streakDays, longestStreak, xpLog, weeklyGoalHours, weeklyReviews, focusSessions, focusSettings } = get();
        return JSON.stringify(
          { version: 2, exportedAt: new Date().toISOString(), xp, tasks, badges, lastActiveDate, streakDays, longestStreak, xpLog, weeklyGoalHours, weeklyReviews, focusSessions, focusSettings },
          null,
          2
        );
      },

      importJson: (raw) => {
        try {
          const data = JSON.parse(raw);
          set({
            xp: data.xp ?? 0,
            tasks: data.tasks ?? {},
            badges: data.badges ?? [],
            lastActiveDate: data.lastActiveDate ?? null,
            streakDays: data.streakDays ?? 0,
            longestStreak: data.longestStreak ?? 0,
            xpLog: data.xpLog ?? [],
            weeklyGoalHours: data.weeklyGoalHours ?? 10,
            weeklyReviews: data.weeklyReviews ?? [],
            // older exports/sync payloads have no focus data: keep what's local
            focusSessions: Array.isArray(data.focusSessions) ? data.focusSessions : get().focusSessions,
            focusSettings: data.focusSettings ? sanitizeSettings(data.focusSettings) : get().focusSettings,
            timer: null,
          });
          return true;
        } catch {
          return false;
        }
      },
      };
    },
    {
      name: "ai-learning-tracker-v1",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? localStorage : (undefined as unknown as Storage))),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);

// Derived selectors.
// IMPORTANT: do NOT export selectors that return fresh objects every call
// (e.g. { current, next, progress }) — Zustand's default Object.is comparison
// will trigger an infinite re-render loop. Subscribe to the primitive `xp`
// and derive via `levelFromXp(xp)` in the component instead.
export const selectCompletedTaskCount = (s: AppState) =>
  Object.values(s.tasks).filter((t) => t.status === "done" || t.status === "mastered").length;

// --- Optional Supabase sync (runs only if env vars set) ---
export async function syncToSupabase() {
  if (!isSupabaseEnabled) return;
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const state = useStore.getState();
  await sb.from("user_progress").upsert({
    user_id: user.id,
    data: {
      xp: state.xp,
      tasks: state.tasks,
      badges: state.badges,
      lastActiveDate: state.lastActiveDate,
      streakDays: state.streakDays,
      longestStreak: state.longestStreak,
      xpLog: state.xpLog.slice(0, 200),
      focusSessions: state.focusSessions.slice(0, 500),
      focusSettings: state.focusSettings,
    },
    updated_at: new Date().toISOString(),
  });
}

export async function loadFromSupabase() {
  if (!isSupabaseEnabled) return;
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data } = await sb.from("user_progress").select("data").eq("user_id", user.id).maybeSingle();
  if (data?.data) {
    useStore.getState().importJson(JSON.stringify(data.data));
  }
}
