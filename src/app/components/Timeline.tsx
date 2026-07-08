"use client";

import { useRef, type MouseEvent } from "react";

export type Step = {
  id: string;
  start: number;
  end: number;
  count?: number;
  word_tag?: string;
  meaning_tag?: string;
};

type Props = {
  duration: number;
  currentTime: number;
  steps: Step[];
  pendingStart: number | null;
  chunkSize: number;
  selectedStepId: string | null;
  onTap: (time: number) => void;
  onCancelPending: () => void;
  onSelectStep: (id: string) => void;
  onDeleteStep: (id: string) => void;
};

export default function Timeline({
  duration,
  currentTime,
  steps,
  pendingStart,
  chunkSize,
  selectedStepId,
  onTap,
  onCancelPending,
  onSelectStep,
  onDeleteStep,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);

  function timeFromClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track || duration <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function handleTrackClick(e: MouseEvent<HTMLDivElement>) {
    onTap(timeFromClientX(e.clientX));
  }

  function pct(time: number): number {
    if (duration <= 0) return 0;
    return (time / duration) * 100;
  }

  function fmt(t: number): string {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2);
    return `${m}:${s.padStart(5, "0")}`;
  }

  return (
    <div className="w-full">
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className="relative h-16 w-full cursor-crosshair rounded bg-zinc-800"
      >
        {/* Chunk boundary bands, alternating shade every `chunkSize` steps */}
        {steps.map((step, i) =>
          Math.floor(i / chunkSize) % 2 === 1 ? (
            <div
              key={`band-${step.id}`}
              className="absolute top-0 h-full bg-white/5"
              style={{
                left: `${pct(step.start)}%`,
                width: `${pct(step.end - step.start)}%`,
              }}
            />
          ) : null
        )}

        {/* Committed step segments */}
        {steps.map((step) => (
          <div
            key={step.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelectStep(step.id);
            }}
            title="Click to select"
            className={`absolute top-1 h-14 rounded border-2 ${
              step.id === selectedStepId
                ? "border-emerald-400 bg-emerald-400/40"
                : "border-emerald-600/70 bg-emerald-600/30"
            }`}
            style={{
              left: `${pct(step.start)}%`,
              width: `${Math.max(0.5, pct(step.end - step.start))}%`,
            }}
          />
        ))}

        {/* Pending (open) marker waiting for the closing tap */}
        {pendingStart !== null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-amber-400"
            style={{ left: `${pct(pendingStart)}%` }}
          />
        )}

        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 h-full w-0.5 bg-white"
          style={{ left: `${pct(currentTime)}%` }}
        />
      </div>

      <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
        <span>
          {pendingStart !== null
            ? `Step starts at ${fmt(pendingStart)} — tap where it ends`
            : "Tap the track to mark where a step starts (video pauses there so you can check the frame)"}
        </span>
        <span className="shrink-0 pl-2">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
      </div>

      {pendingStart !== null && (
        <button
          onClick={onCancelPending}
          className="mt-2 rounded border border-amber-500 px-2 py-1 text-xs font-medium text-amber-400"
        >
          Cancel (Esc)
        </button>
      )}

      {steps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {steps.map((step, i) => (
            <div
              key={step.id}
              className={`flex items-center overflow-hidden rounded text-xs ${
                step.id === selectedStepId
                  ? "bg-emerald-500 text-black"
                  : "bg-zinc-800 text-zinc-300"
              }`}
            >
              <button
                onClick={() => onSelectStep(step.id)}
                title={`${fmt(step.start)} – ${fmt(step.end)}`}
                className="px-2 py-1"
              >
                {i + 1}{step.word_tag ? ` · ${step.word_tag}` : ""}{step.count ? ` (${step.count})` : ""}
              </button>
              <button
                onClick={() => onDeleteStep(step.id)}
                title="Delete this step"
                className={`px-1.5 py-1 font-bold hover:bg-red-500 hover:text-white ${
                  step.id === selectedStepId ? "text-black/60" : "text-zinc-500"
                }`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
