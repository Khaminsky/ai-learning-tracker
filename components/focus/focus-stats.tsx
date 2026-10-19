"use client";
import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  formatDuration, getTaskMeta, lastNLocalDays, localDayKey, secByDay, secByTask, secByTrack,
  secThisWeek, secToday,
} from "@/lib/focus";
import { cn } from "@/lib/utils";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight mt-1">{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function FocusStats() {
  const sessions = useStore((s) => s.focusSessions);
  const goalHours = useStore((s) => s.weeklyGoalHours);
  const del = useStore((s) => s.deleteFocusSession);

  const data = useMemo(() => {
    const days = lastNLocalDays(7);
    const perDay = secByDay(sessions, days);
    const byTask = Array.from(secByTask(sessions).entries())
      .map(([id, sec]) => ({ id, sec, meta: getTaskMeta(id) }))
      .sort((a, b) => b.sec - a.sec)
      .slice(0, 6);
    const tracks = Object.entries(secByTrack(sessions)).sort((a, b) => b[1] - a[1]);
    return {
      days, perDay, byTask, tracks,
      week: secThisWeek(sessions),
      today: secToday(sessions),
      total: sessions.reduce((s, f) => s + f.durationSec, 0),
    };
  }, [sessions]);

  const maxDay = Math.max(...data.perDay, 1);
  const trackTotal = data.tracks.reduce((s, [, v]) => s + v, 0) || 1;
  const weekPct = Math.min(100, Math.round((data.week / 3600 / goalHours) * 100));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Today" value={formatDuration(data.today)} />
        <Stat label="This week" value={formatDuration(data.week)} hint={`${weekPct}% of ${goalHours}h goal`} />
        <Stat label="Sessions" value={String(sessions.length)} hint="all time" />
        <Stat label="Total focus" value={formatDuration(data.total)} hint="all time" />
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold tracking-tight">Last 7 days</h3>
            <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(data.perDay.reduce((a, b) => a + b, 0))}</span>
          </div>
          <div className="flex items-end gap-2 h-32">
            {data.days.map((d, i) => {
              const sec = data.perDay[i];
              const isToday = i === data.days.length - 1;
              return (
                <div key={d} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full min-w-0">
                  <span className="text-[10px] text-muted-foreground tabular-nums">{sec ? formatDuration(sec) : ""}</span>
                  <div
                    className={cn("w-full rounded-t-md", isToday ? "bg-orange-500" : "bg-foreground/70")}
                    style={{ height: `${Math.max(sec ? 4 : 0, (sec / maxDay) * 80)}%` }}
                    title={`${d}: ${formatDuration(sec)}`}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold tracking-tight mb-3">Time by track</h3>
            {data.tracks.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing logged yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.tracks.map(([track, sec]) => (
                  <li key={track}>
                    <div className="flex justify-between text-xs mb-1">
                      <span>{track}</span>
                      <span className="text-muted-foreground tabular-nums">{formatDuration(sec)}</span>
                    </div>
                    <Progress value={Math.round((sec / trackTotal) * 100)} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold tracking-tight mb-1">Estimate vs actual</h3>
            <p className="text-xs text-muted-foreground mb-3">Your most-worked tasks against their estimated time.</p>
            {data.byTask.length === 0 ? (
              <p className="text-xs text-muted-foreground">Start a session from a task to see this.</p>
            ) : (
              <ul className="space-y-2.5">
                {data.byTask.map(({ id, sec, meta }) => {
                  const est = meta?.estMin;
                  const over = est ? sec / 60 > est : false;
                  return (
                    <li key={id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate">{meta?.title ?? id}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        <span className={cn("font-medium", over ? "text-orange-500" : "text-foreground")}>{formatDuration(sec)}</span>
                        {est ? ` / ~${formatDuration(est * 60)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold tracking-tight mb-3">Recent sessions</h3>
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sessions yet — start the timer above.</p>
          ) : (
            <ul className="divide-y divide-border">
              {sessions.slice(0, 10).map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{(s.taskId && getTaskMeta(s.taskId)?.title) || "Free focus"}</p>
                    <p className="text-muted-foreground">
                      {localDayKey(s.startedAt) === localDayKey(new Date()) ? "Today" : new Date(s.startedAt).toLocaleDateString()}{" "}
                      {new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {s.mode}
                      {s.xp > 0 && ` · +${s.xp} XP`}
                    </p>
                  </div>
                  <span className="tabular-nums font-medium">{formatDuration(s.durationSec)}</span>
                  <button
                    onClick={() => del(s.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="Delete session"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
