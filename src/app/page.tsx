"use client";

import { useEffect, useState } from "react";
import SkeletonViewer from "@/app/components/SkeletonViewer";
import { listBreakdowns, type SavedBreakdown } from "@/lib/breakdowns";

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [saved, setSaved] = useState<SavedBreakdown[]>([]);
  const [loadId, setLoadId] = useState<string | undefined>(undefined);

  useEffect(() => {
    listBreakdowns()
      .then(setSaved)
      .catch((err) => console.error("Failed to list breakdowns", err));
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-950 px-6 py-12 text-white">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold">Dance skeleton — proof of concept</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Upload a dance video. We run pose detection in your browser and show
          only a white figure, the original video never leaves your device
          and never gets shown.
        </p>

        <div className="mt-6">
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setVideoFile(file);
            }}
            className="block w-full text-sm text-zinc-300"
          />
        </div>

        {saved.length > 0 && (
          <div className="mt-6 rounded border border-zinc-800 p-3">
            <p className="text-xs text-zinc-400">
              Saved breakdowns (re-upload the matching video, then pick one to
              restore its steps):
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {saved.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setLoadId(b.id)}
                    className={`w-full rounded px-2 py-1 text-left text-xs ${
                      loadId === b.id
                        ? "bg-sky-600 text-white"
                        : "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {b.title} — {new Date(b.created_at).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {videoFile && (
          <div className="mt-8">
            <SkeletonViewer videoFile={videoFile} loadId={loadId} />
          </div>
        )}
      </div>
    </div>
  );
}
