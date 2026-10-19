"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Coffee, Pause, Play, Timer } from "lucide-react";
import { useStore } from "@/lib/store";
import { elapsedMs, formatClock, isRunning } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { useNow } from "./use-now";

/** Compact top-bar timer: links to /focus, with a quick pause/resume toggle when a run is active. */
export function TimerChip() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const hydrated = useStore((s) => s.hydrated);
  const timer = useStore((s) => s.timer);
  const pause = useStore((s) => s.pauseFocus);
  const resume = useStore((s) => s.resumeFocus);
  const now = useNow(isRunning(timer));

  if (!mounted || !hydrated) return <div className="h-9 w-9 sm:w-[84px]" aria-hidden />;

  if (!timer) {
    return (
      <Link
        href="/focus"
        className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-xs"
        aria-label="Open focus timer"
      >
        <Timer className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Focus</span>
      </Link>
    );
  }

  const running = isRunning(timer);
  const e = elapsedMs(timer, now);
  const shown = timer.targetMs !== null ? Math.max(0, timer.targetMs - e) : e;
  const isBreak = timer.phase !== "work";
  const Icon = isBreak ? Coffee : Timer;

  return (
    <div
      className={cn(
        "flex items-center h-9 rounded-lg border bg-background overflow-hidden",
        isBreak ? "border-emerald-500/50" : "border-orange-500/50"
      )}
    >
      <Link
        href="/focus"
        className="flex items-center gap-1.5 h-full pl-2.5 pr-2 text-xs hover:bg-accent/50 transition-colors"
        aria-label={`${isBreak ? "Break" : "Focus"} timer ${formatClock(shown)}`}
      >
        <Icon className={cn("w-3.5 h-3.5", isBreak ? "text-emerald-500" : "text-orange-500")} />
        <span className={cn("font-medium tabular-nums text-foreground", !running && "opacity-60")}>{formatClock(shown)}</span>
      </Link>
      <button
        onClick={running ? pause : resume}
        className="h-full px-2 border-l border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        aria-label={running ? "Pause timer" : "Resume timer"}
      >
        {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
