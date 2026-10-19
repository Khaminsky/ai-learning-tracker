"use client";
import { FocusTimer } from "@/components/focus/focus-timer";
import { FocusStats } from "@/components/focus/focus-stats";

export default function FocusPage() {
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Focus</h1>
        <p className="text-sm text-muted-foreground">
          Time your learning with a Pomodoro or a free-running stopwatch. Sessions feed your weekly goal and per-task stats.
        </p>
      </div>
      <div className="max-w-xl mx-auto">
        <FocusTimer />
      </div>
      <FocusStats />
    </div>
  );
}
