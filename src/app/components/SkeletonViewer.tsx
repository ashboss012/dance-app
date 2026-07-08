"use client";

import { useEffect, useRef, useState } from "react";
import { PoseLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";
import Timeline, { type Step } from "@/app/components/Timeline";
import { saveBreakdown, loadBreakdown } from "@/lib/breakdowns";


type Props = {
  videoFile: File;
  loadId?: string;
};

type PlayRange = { stopAt: number; onDone?: () => void } | null;

type RecordingState = "idle" | "recording" | "recorded";

export default function SkeletonViewer({ videoFile, loadId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationFrameRef = useRef<number>(0);
  const playRangeRef = useRef<PlayRange>(null);

  // Phase 5 — beat detection
  const audioBufferRef = useRef<AudioBuffer | null>(null);

  // Phase 4 — self-recording mirror
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  const selfPlaybackRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0); // skeleton time when recording started
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [selfRecordingUrl, setSelfRecordingUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState("");

  const [status, setStatus] = useState<"loading-model" | "ready" | "error">(
    "loading-model"
  );
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const [steps, setSteps] = useState<Step[]>([]);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [playingStepIndex, setPlayingStepIndex] = useState<number | null>(null);
  const [chunkSize, setChunkSize] = useState(3);
  const [playbackRate, setPlaybackRate] = useState(0.5);

  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState("");
  const [suggestState, setSuggestState] = useState<"idle" | "loading" | "error">("idle");
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const [beatTimestamps, setBeatTimestamps] = useState<number[]>([]);
  const [beatChunkSize, setBeatChunkSize] = useState<4 | 8 | 16>(8);
  const [learningStarted, setLearningStarted] = useState(false);

  // Guided practice session state
  type PracticeTask = { label: string; stepsToPlay: Step[] };
  type PracticePhase =
    | { kind: "idle" }
    | { kind: "task"; taskIndex: number; tasks: PracticeTask[]; played: boolean }
    | { kind: "done" };
  const [practice, setPractice] = useState<PracticePhase>({ kind: "idle" });

  useEffect(() => {
    if (!loadId) return;
    let cancelled = false;
    loadBreakdown(loadId)
      .then(({ chunkSize: savedChunkSize, steps: savedSteps }) => {
        if (cancelled) return;
        setChunkSize(savedChunkSize);
        setSteps(savedSteps);
      })
      .catch((err) => {
        console.error("Failed to load breakdown", err);
      });
    return () => {
      cancelled = true;
    };
  }, [loadId]);

  // Decode the video file's audio track once so beat detection can run
  // synchronously against the raw PCM samples without re-decoding each time.
  useEffect(() => {
    let cancelled = false;
    async function decodeAudio() {
      try {
        const arrayBuffer = await videoFile.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        if (!cancelled) {
          audioBufferRef.current = decoded;
          const result = detectBeats(decoded);
          setDetectedBpm(result.bpm);
          setBeatTimestamps(result.beatTimestamps);
        }
        ctx.close();
      } catch {
        // Silent — beat detection simply won't suggest a count if this fails.
      }
    }
    decodeAudio();
    return () => { cancelled = true; };
  }, [videoFile]);

  // Energy-envelope beat counter. Returns an estimated number of beats in the
  // given time range, or 0 if the audio buffer isn't ready yet.
  function detectBeatCount(startSec: number, endSec: number): number {
    const buf = audioBufferRef.current;
    if (!buf) return 0;
    const sr = buf.sampleRate;
    const ch = buf.getChannelData(0);
    const s0 = Math.floor(startSec * sr);
    const s1 = Math.min(Math.floor(endSec * sr), ch.length);
    const winLen = Math.floor(0.05 * sr); // 50 ms windows
    const energies: number[] = [];
    for (let i = s0; i < s1 - winLen; i += winLen) {
      let e = 0;
      for (let j = i; j < i + winLen; j++) e += ch[j] * ch[j];
      energies.push(e / winLen);
    }
    if (energies.length === 0) return 0;
    const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
    const threshold = mean * 1.5;
    let beats = 0;
    let lastBeat = -10;
    for (let i = 1; i < energies.length - 1; i++) {
      if (
        energies[i] > threshold &&
        energies[i] >= energies[i - 1] &&
        energies[i] >= energies[i + 1] &&
        i - lastBeat > 3
      ) {
        beats++;
        lastBeat = i;
      }
    }
    return Math.max(1, beats);
  }

  // Full-song beat detector. Returns BPM and an array of beat timestamps (ms).
  function detectBeats(buffer: AudioBuffer): { bpm: number; beatTimestamps: number[] } {
    const sr = buffer.sampleRate;
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

    // 10ms non-overlapping RMS energy windows
    const hopLen = Math.max(1, Math.floor(0.01 * sr));
    const numHops = Math.floor(ch0.length / hopLen);
    const energy = new Float32Array(numHops);
    for (let i = 0; i < numHops; i++) {
      let e = 0;
      const base = i * hopLen;
      for (let j = 0; j < hopLen; j++) {
        const s = ch1 ? (ch0[base + j] + ch1[base + j]) * 0.5 : ch0[base + j];
        e += s * s;
      }
      energy[i] = e / hopLen;
    }

    // Local mean via prefix sum (±50 windows = ±500ms context)
    const halfWin = 50;
    const prefix = new Float32Array(numHops + 1);
    for (let i = 0; i < numHops; i++) prefix[i + 1] = prefix[i] + energy[i];
    const localMean = new Float32Array(numHops);
    for (let i = 0; i < numHops; i++) {
      const lo = Math.max(0, i - halfWin);
      const hi = Math.min(numHops - 1, i + halfWin);
      localMean[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
    }

    // Peak picking — minimum gap 300ms to cap at ~200 BPM
    const minGap = Math.ceil(0.3 / 0.01);
    const beats: number[] = [];
    let lastBeat = -minGap;
    for (let i = 1; i < numHops - 1; i++) {
      if (
        energy[i] > localMean[i] * 1.5 &&
        energy[i] >= energy[i - 1] &&
        energy[i] >= energy[i + 1] &&
        i - lastBeat >= minGap
      ) {
        beats.push((i * hopLen / sr) * 1000);
        lastBeat = i;
      }
    }

    // BPM from median inter-beat interval
    let bpm = 120;
    if (beats.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < beats.length; i++) diffs.push(beats[i] - beats[i - 1]);
      diffs.sort((a, b) => a - b);
      const median = diffs[Math.floor(diffs.length / 2)];
      bpm = Math.max(60, Math.min(200, Math.round(60000 / median)));
    }

    return { bpm, beatTimestamps: beats };
  }

  function generateStepsFromBeats(beats: number[], chunkSz: number, videoDuration: number): Step[] {
    if (beats.length === 0) return [];
    const numSteps = Math.ceil(beats.length / chunkSz);
    const result: Step[] = [];
    for (let i = 0; i < numSteps; i++) {
      const startIdx = i * chunkSz;
      const endIdx = startIdx + chunkSz;
      const start = beats[startIdx] / 1000;
      const end = endIdx < beats.length ? beats[endIdx] / 1000 : videoDuration;
      const count = Math.min(chunkSz, beats.length - startIdx);
      result.push({ id: crypto.randomUUID(), start, end, count });
    }
    return result;
  }

  function handleStartLearning() {
    const generated = generateStepsFromBeats(beatTimestamps, beatChunkSize, duration);
    setSteps(generated);
    setLearningStarted(true);
    // Kick off the snowball practice plan using the freshly generated steps
    const tasks = buildPracticePlan(generated, beatChunkSize);
    setPractice({ kind: "task", taskIndex: 0, tasks, played: false });
  }

  async function handleSave() {
    setSaveState("saving");
    setSaveError("");
    try {
      await saveBreakdown({
        title: videoFile.name,
        videoName: videoFile.name,
        chunkSize,
        steps,
      });
      setSaveState("saved");
    } catch (err) {
      console.error("Failed to save breakdown", err);
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  // Load MediaPipe model once
  useEffect(() => {
    let cancelled = false;

    async function loadModel() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );

        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });

        if (!cancelled) {
          poseLandmarkerRef.current = landmarker;
          setStatus("ready");
        }
      } catch (err) {
        console.error("Failed to load pose model", err);
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error ? err.message : "Failed to load pose model"
          );
          setStatus("error");
        }
      }
    }

    loadModel();

    return () => {
      cancelled = true;
      poseLandmarkerRef.current?.close();
    };
  }, []);

  // Render loop + video event listeners
  useEffect(() => {
    if (status !== "ready") return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const videoEl: HTMLVideoElement = video;
    const canvasEl: HTMLCanvasElement = canvas;

    const objectUrl = URL.createObjectURL(videoFile);
    videoEl.src = objectUrl;
    const audioEl = audioRef.current;
    if (audioEl) {
      audioEl.src = objectUrl;
      audioEl.playbackRate = playbackRate;
    }

    const ctx2d = canvasEl.getContext("2d");
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d;
    const drawingUtils = new DrawingUtils(ctx);

    let lastVideoTime = -1;

    function handleLoadedMetadata() {
      setDuration(videoEl.duration);
    }
    function handleTimeUpdate() {
      setCurrentTime(videoEl.currentTime);

      const range = playRangeRef.current;
      if (range && videoEl.currentTime >= range.stopAt) {
        videoEl.pause();
        audioRef.current?.pause();
        selfPlaybackRef.current?.pause();
        playRangeRef.current = null;
        range.onDone?.();
      }
    }
    videoEl.addEventListener("loadedmetadata", handleLoadedMetadata);
    videoEl.addEventListener("timeupdate", handleTimeUpdate);

    function renderLoop() {
      const landmarker = poseLandmarkerRef.current;
      if (
        !landmarker ||
        videoEl.paused ||
        videoEl.ended ||
        videoEl.videoWidth === 0 ||
        videoEl.videoHeight === 0 ||
        videoEl.readyState < 2
      ) {
        animationFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }

      if (canvasEl.width !== videoEl.videoWidth) {
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
      }

      if (videoEl.currentTime !== lastVideoTime) {
        lastVideoTime = videoEl.currentTime;

        const startTimeMs = performance.now();
        landmarker.detectForVideo(videoEl, startTimeMs, (result) => {
          const W = canvasEl.width;
          const H = canvasEl.height;

          // Draw original video dimmed — gives spatial context (floor, room)
          // without showing identity or distracting from the figure.
          ctx.drawImage(videoEl, 0, 0, W, H);
          ctx.fillStyle = "rgba(0,0,0,0.62)";
          ctx.fillRect(0, 0, W, H);

          for (const landmarks of result.landmarks) {
            drawingUtils.drawConnectors(
              landmarks,
              PoseLandmarker.POSE_CONNECTIONS,
              { color: "#FFFFFF", lineWidth: 4 }
            );
            drawingUtils.drawLandmarks(landmarks, {
              color: "#FFFFFF",
              fillColor: "#FFFFFF",
              radius: 5,
            });
          }
        });
      }

      animationFrameRef.current = requestAnimationFrame(renderLoop);
    }

    videoEl.playbackRate = playbackRate;
    // Do NOT autoplay — unmuted video requires a user gesture to unblock audio.
    animationFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      videoEl.removeEventListener("loadedmetadata", handleLoadedMetadata);
      videoEl.removeEventListener("timeupdate", handleTimeUpdate);
      URL.revokeObjectURL(objectUrl);
    };
  }, [status, videoFile]);

  function handleTimelineTap(time: number) {
    const videoEl = videoRef.current;
    if (videoEl) {
      videoEl.pause();
      videoEl.currentTime = time;
    }
    const audioEl = audioRef.current;
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = time;
    }

    if (pendingStart === null) {
      setPendingStart(time);
      return;
    }
    const start = Math.min(pendingStart, time);
    const end = Math.max(pendingStart, time);
    if (end - start < 0.05) return;
    const detectedCount = detectBeatCount(start, end);
    const newStep: Step = {
      id: crypto.randomUUID(),
      start,
      end,
      count: detectedCount || undefined,
    };
    setSteps((prev) =>
      [...prev, newStep].sort((a, b) => a.start - b.start)
    );
    setSelectedStepId(newStep.id);
    setPendingStart(null);
  }

  function handleCancelPending() {
    setPendingStart(null);
  }

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  function handleDeleteStep(id: string) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
    if (selectedStepId === id) setSelectedStepId(null);
  }

  function fmt(t: number): string {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function handleUpdateStep(id: string, patch: Partial<Pick<Step, "count" | "word_tag" | "meaning_tag">>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function handleSuggestMeaning(stepId: string, wordTag: string) {
    if (!wordTag.trim()) return;
    setSuggestState("loading");
    try {
      const res = await fetch("/api/suggest-meaning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word_tag: wordTag }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Suggestion failed");
      handleUpdateStep(stepId, { meaning_tag: data.suggestion });
      setSuggestState("idle");
    } catch (err) {
      console.error("Suggest meaning failed", err);
      setSuggestState("error");
    }
  }

  // Build the snowball practice plan:
  // chunk 1 → chunk 2 → chunks 1–2 → chunk 3 → chunks 1–3 → …
  function buildPracticePlan(allSteps: Step[], cs: number): PracticeTask[] {
    const tasks: PracticeTask[] = [];
    const numChunks = Math.ceil(allSteps.length / cs);
    for (let i = 0; i < numChunks; i++) {
      const start = i * cs;
      const end = Math.min(start + cs, allSteps.length);
      tasks.push({
        label: `Learn chunk ${i + 1} (steps ${start + 1}–${end})`,
        stepsToPlay: allSteps.slice(start, end),
      });
      if (i > 0) {
        tasks.push({
          label: `Run chunks 1–${i + 1} together`,
          stepsToPlay: allSteps.slice(0, end),
        });
      }
    }
    return tasks;
  }

  function startPractice() {
    if (steps.length === 0) return;
    const tasks = buildPracticePlan(steps, chunkSize);
    setPractice({ kind: "task", taskIndex: 0, tasks, played: false });
  }

  // Auto-play when a new task starts (played === false)
  useEffect(() => {
    if (practice.kind !== "task" || practice.played) return;
    playSequence(practice.tasks[practice.taskIndex].stepsToPlay);
    setPractice((p) => (p.kind === "task" ? { ...p, played: true } : p));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice]);

  function practiceAgain() {
    if (practice.kind !== "task") return;
    playSequence(practice.tasks[practice.taskIndex].stepsToPlay);
  }

  function practiceNext() {
    if (practice.kind !== "task") return;
    const next = practice.taskIndex + 1;
    if (next >= practice.tasks.length) {
      setPractice({ kind: "done" });
    } else {
      setPractice({ kind: "task", taskIndex: next, tasks: practice.tasks, played: false });
    }
  }

  function stopPractice() {
    setPractice({ kind: "idle" });
    videoRef.current?.pause();
    audioRef.current?.pause();
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.key === "Escape" && pendingStart !== null) {
        setPendingStart(null);
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedStepId !== null
      ) {
        handleDeleteStep(selectedStepId);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingStart, selectedStepId]);

  // Plays a sequence of steps. If a self-recording exists, syncs it to the
  // same time offsets relative to when the recording started.
  function playSequence(sequence: Step[]) {
    const videoEl = videoRef.current;
    if (!videoEl || sequence.length === 0) return;

    function playFrom(index: number) {
      if (!videoEl) return;
      const step = sequence[index];
      const isLast = index === sequence.length - 1;
      // Find this step's position in the full steps array for the beat counter
      const globalIndex = steps.findIndex((s) => s.id === step.id);
      setPlayingStepIndex(globalIndex === -1 ? null : globalIndex);
      videoEl.currentTime = step.start;
      videoEl.playbackRate = playbackRate;
      playRangeRef.current = {
        stopAt: step.end,
        onDone: isLast
          ? () => setPlayingStepIndex(null)
          : () => playFrom(index + 1),
      };
      videoEl.play().catch(() => {});
      const audioEl = audioRef.current;
      if (audioEl) {
        audioEl.currentTime = step.start;
        audioEl.playbackRate = playbackRate;
        audioEl.play().catch(() => {});
      }

      const selfEl = selfPlaybackRef.current;
      if (selfEl && selfEl.readyState >= 1) {
        const offset = step.start - recordingStartTimeRef.current;
        selfEl.currentTime = Math.max(0, offset);
        selfEl.playbackRate = playbackRate;
        selfEl.play().catch(() => {});
      }
    }

    playFrom(0);
  }

  const selectedIndex = steps.findIndex((s) => s.id === selectedStepId);

  function playSelectedStep() {
    if (selectedIndex === -1) return;
    playSequence([steps[selectedIndex]]);
  }

  function playChunkFromSelected() {
    if (selectedIndex === -1) return;
    const chunkStart = Math.floor(selectedIndex / chunkSize) * chunkSize;
    playSequence(steps.slice(chunkStart, chunkStart + chunkSize));
  }

  function playFromTop() {
    playSequence(steps);
  }

  // --- Phase 4: self-recording ---

  async function startRecording() {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      if (cameraPreviewRef.current) {
        cameraPreviewRef.current.srcObject = stream;
        cameraPreviewRef.current.play().catch(() => {});
      }
      recordedChunksRef.current = [];
      // Note the skeleton's current time so playback can compute the offset
      recordingStartTimeRef.current = videoRef.current?.currentTime ?? 0;

      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm",
      });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null;
        const blob = new Blob(recordedChunksRef.current, {
          type: "video/webm",
        });
        const url = URL.createObjectURL(blob);
        setSelfRecordingUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setRecordingState("recorded");
      };
      mr.start(100); // collect data every 100 ms
      mediaRecorderRef.current = mr;
      setRecordingState("recording");
    } catch (err) {
      setCameraError(
        err instanceof Error ? err.message : "Camera access denied"
      );
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function discardRecording() {
    setSelfRecordingUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setRecordingState("idle");
    recordingStartTimeRef.current = 0;
  }

  // Clean up camera stream and recording URL on unmount
  useEffect(() => {
    return () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const hasSelfRecording = recordingState === "recorded" && selfRecordingUrl;

  return (
    <div className="flex flex-col items-center gap-3">
      {status === "loading-model" && (
        <p className="text-sm text-gray-400">Loading pose model...</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-500">
          Couldn&apos;t load the pose model: {errorMessage}
        </p>
      )}

      <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-0 h-0" playsInline muted />
      <audio ref={audioRef} />

      {/* Main display: skeleton + self-recording side by side when available */}
      <div
        className={`flex w-full gap-2 ${hasSelfRecording || recordingState === "recording" ? "flex-row items-start" : "flex-col items-center"}`}
      >
        <div className={hasSelfRecording || recordingState === "recording" ? "flex-1" : "w-full"}>
          <div className="relative w-full">
            <canvas
              ref={canvasRef}
              className="w-full rounded-lg bg-black"
              style={{ aspectRatio: "9 / 16", maxHeight: "60vh" }}
            />
            {status === "ready" && duration === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="rounded bg-black/60 px-3 py-1.5 text-sm text-white">
                  Press Play to begin
                </span>
              </div>
            )}
          </div>
          {/* Live beat counter — shows during step/chunk/from-the-top playback */}
          {(() => {
            if (playingStepIndex === null) return null;
            const ps = steps[playingStepIndex];
            if (!ps || !ps.count || ps.count < 1) return null;
            const elapsed = currentTime - ps.start;
            const beatInterval = (ps.end - ps.start) / ps.count;
            const beatNum = Math.min(
              ps.count,
              Math.floor(elapsed / beatInterval) + 1
            );
            return (
              <div className="mt-2 flex items-center justify-center gap-3">
                <span className="text-5xl font-bold tabular-nums text-white">
                  {beatNum}
                </span>
                <span className="text-sm text-zinc-400">/ {ps.count}</span>
                {ps.word_tag && (
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-sm text-zinc-300">
                    {ps.word_tag}
                  </span>
                )}
              </div>
            );
          })()}
          <p className="mt-1 text-center text-xs text-zinc-500">Skeleton</p>
        </div>

        {/* Camera preview while recording */}
        {recordingState === "recording" && (
          <div className="flex-1">
            <video
              ref={cameraPreviewRef}
              className="w-full rounded-lg bg-zinc-900 [transform:scaleX(-1)]"
              style={{ aspectRatio: "9 / 16", maxHeight: "60vh" }}
              playsInline
              muted
            />
            <p className="mt-1 text-center text-xs text-zinc-500">You (live)</p>
          </div>
        )}

        {/* Recorded playback */}
        {hasSelfRecording && (
          <div className="flex-1">
            <video
              ref={selfPlaybackRef}
              src={selfRecordingUrl}
              className="w-full rounded-lg bg-zinc-900 [transform:scaleX(-1)]"
              style={{ aspectRatio: "9 / 16", maxHeight: "60vh" }}
              playsInline
              muted
            />
            <p className="mt-1 text-center text-xs text-zinc-500">You</p>
          </div>
        )}
      </div>

      <div className="flex w-full max-w-xl flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (audioRef.current) { audioRef.current.playbackRate = playbackRate; audioRef.current.play(); }
              videoRef.current?.play();
            }}
            className="rounded bg-white px-4 py-2 text-sm font-medium text-black"
          >
            Play
          </button>
          <button
            onClick={() => { videoRef.current?.pause(); audioRef.current?.pause(); }}
            className="rounded border border-gray-600 px-4 py-2 text-sm font-medium text-white"
          >
            Pause
          </button>
          <label className="ml-auto flex items-center gap-1 text-xs text-zinc-400">
            Speed
            <select
              value={playbackRate}
              onChange={(e) => setPlaybackRate(Number(e.target.value))}
              className="rounded bg-zinc-800 px-1 py-0.5 text-white"
            >
              <option value={0.25}>0.25x</option>
              <option value={0.5}>0.5x</option>
              <option value={0.75}>0.75x</option>
              <option value={1}>1x</option>
            </select>
          </label>
        </div>

        {duration > 0 && (
          <div className="flex items-center gap-2">
            <span className="w-20 text-right text-xs tabular-nums text-zinc-400">
              {fmt(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={currentTime}
              onChange={(e) => {
                const t = Number(e.target.value);
                if (videoRef.current) videoRef.current.currentTime = t;
                if (audioRef.current) audioRef.current.currentTime = t;
                setCurrentTime(t);
              }}
              className="flex-1 accent-white"
            />
            <span className="w-20 text-xs tabular-nums text-zinc-400">
              {fmt(duration)}
            </span>
          </div>
        )}
      </div>

      {/* Setup screen — shown after beat detection, before learning starts */}
      {detectedBpm !== null && !learningStarted && duration > 0 && (
        <div className="w-full max-w-xl rounded border border-zinc-700 bg-zinc-900 p-4">
          <p className="mb-3 text-sm font-medium text-white">
            Detected <span className="text-emerald-400">{detectedBpm} BPM</span>
            <span className="ml-2 text-zinc-500 font-normal">· {beatTimestamps.length} beats</span>
          </p>
          <p className="mb-2 text-xs text-zinc-400">How many beats per step?</p>
          <div className="mb-4 flex gap-2">
            {([4, 8, 16] as const).map((n) => {
              const stepCount = Math.ceil(beatTimestamps.length / n);
              return (
                <button
                  key={n}
                  onClick={() => setBeatChunkSize(n)}
                  className={`flex-1 rounded border px-3 py-2 text-sm font-medium transition-colors ${
                    beatChunkSize === n
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                      : "border-zinc-600 text-zinc-400 hover:border-zinc-400"
                  }`}
                >
                  {n}-count
                  <span className="ml-1 text-xs font-normal opacity-60">({stepCount} steps)</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={handleStartLearning}
            disabled={beatTimestamps.length === 0}
            className="w-full rounded bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Start Learning →
          </button>
        </div>
      )}

      {status === "ready" && duration > 0 && learningStarted && (
        <div className="w-full max-w-xl">
          <Timeline
            duration={duration}
            currentTime={currentTime}
            steps={steps}
            pendingStart={pendingStart}
            chunkSize={chunkSize}
            selectedStepId={selectedStepId}
            onTap={handleTimelineTap}
            onCancelPending={handleCancelPending}
            onSelectStep={setSelectedStepId}
            onDeleteStep={handleDeleteStep}
          />

          {/* Phase 5 — beat count + meaning tag detail panel */}
          {selectedIndex !== -1 && (() => {
            const s = steps[selectedIndex];
            return (
              <div className="mt-3 rounded border border-zinc-700 p-3">
                <p className="mb-2 text-xs font-medium text-zinc-400">
                  Step {selectedIndex + 1}&nbsp;
                  <span className="font-normal text-zinc-500">
                    {fmt(s.start)} – {fmt(s.end)}
                  </span>
                </p>
                <div className="flex flex-col gap-2">
                  {/* Beat count */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-zinc-400">Beat count</label>
                    <input
                      type="number"
                      min={1}
                      value={s.count ?? ""}
                      onChange={(e) =>
                        handleUpdateStep(s.id, {
                          count: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      placeholder="—"
                      className="w-14 rounded bg-zinc-800 px-2 py-1 text-center text-xs text-white placeholder-zinc-600"
                    />
                    <span className="text-xs text-zinc-600">
                      {s.count ? "auto-detected · override if wrong" : "no audio detected"}
                    </span>
                  </div>

                  {/* Word / lyric */}
                  <label className="flex flex-col gap-0.5 text-xs text-zinc-400">
                    Word / lyric
                    <input
                      type="text"
                      value={s.word_tag ?? ""}
                      onChange={(e) =>
                        handleUpdateStep(s.id, { word_tag: e.target.value || undefined })
                      }
                      placeholder='e.g. "step" or "right foot"'
                      className="rounded bg-zinc-800 px-2 py-1 text-white placeholder-zinc-600"
                    />
                  </label>

                  {/* Meaning / gesture + Gemini suggest */}
                  <div className="flex flex-col gap-0.5">
                    <label className="text-xs text-zinc-400">Meaning / gesture</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={s.meaning_tag ?? ""}
                        onChange={(e) =>
                          handleUpdateStep(s.id, { meaning_tag: e.target.value || undefined })
                        }
                        placeholder='e.g. "wave arms outward"'
                        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-white placeholder-zinc-600"
                      />
                      <button
                        onClick={() => handleSuggestMeaning(s.id, s.word_tag ?? "")}
                        disabled={!s.word_tag || suggestState === "loading"}
                        title="Ask Gemini to suggest a gesture from the word/lyric"
                        className="rounded bg-violet-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                      >
                        {suggestState === "loading" ? "…" : "Suggest"}
                      </button>
                    </div>
                    {suggestState === "error" && (
                      <p className="mt-0.5 text-xs text-red-400">
                        Failed — is GEMINI_API_KEY set in .env.local?
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-zinc-400">
              Chunk size
              <input
                type="number"
                min={1}
                max={steps.length || 1}
                value={chunkSize}
                onChange={(e) =>
                  setChunkSize(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-12 rounded bg-zinc-800 px-1 py-0.5 text-center text-white"
              />
            </label>

            <button
              onClick={playSelectedStep}
              disabled={selectedIndex === -1}
              className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
            >
              Play this step
            </button>
            <button
              onClick={playChunkFromSelected}
              disabled={selectedIndex === -1}
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Play chunk
            </button>
            <button
              onClick={playFromTop}
              disabled={steps.length === 0}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              From the top
            </button>

            <button
              onClick={handleSave}
              disabled={steps.length === 0 || saveState === "saving"}
              className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {saveState === "saving" ? "Saving..." : "Save breakdown"}
            </button>
            {saveState === "saved" && (
              <span className="text-xs text-emerald-400">Saved</span>
            )}
            {saveState === "error" && (
              <span className="text-xs text-red-400">{saveError}</span>
            )}
          </div>

          {/* Guided practice session */}
          {steps.length > 0 && (
            <div className="mt-4 rounded border border-indigo-800 bg-indigo-950/40 p-3">
              {practice.kind === "idle" && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-indigo-300">
                    <span className="font-semibold">Guided practice</span> — the app walks you through chunk by chunk, building up until you have the whole thing.
                  </p>
                  <button
                    onClick={startPractice}
                    className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                  >
                    Start session
                  </button>
                </div>
              )}

              {practice.kind === "task" && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-indigo-400">
                        Step {practice.taskIndex + 1} of {practice.tasks.length}
                      </p>
                      <p className="text-sm font-medium text-white">
                        {practice.tasks[practice.taskIndex].label}
                      </p>
                    </div>
                    <button
                      onClick={stopPractice}
                      className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      Exit
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={practiceAgain}
                      className="rounded border border-indigo-600 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-900"
                    >
                      ↺ Play again
                    </button>
                    <button
                      onClick={practiceNext}
                      className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                    >
                      {practice.taskIndex + 1 < practice.tasks.length ? "✓ Good, next →" : "✓ Done!"}
                    </button>
                  </div>
                </div>
              )}

              {practice.kind === "done" && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-emerald-400">
                    You ran the whole thing! Great work.
                  </p>
                  <button
                    onClick={startPractice}
                    className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                  >
                    Practice again
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Phase 4 — Mirror recording controls */}
          <div className="mt-4 rounded border border-zinc-700 p-3">
            <p className="mb-2 text-xs font-medium text-zinc-300">
              Mirror — record yourself dancing
            </p>
            {cameraError && (
              <p className="mb-2 text-xs text-red-400">{cameraError}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {recordingState === "idle" && (
                <button
                  onClick={startRecording}
                  className="rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Start recording
                </button>
              )}
              {recordingState === "recording" && (
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-white" />
                  Stop recording
                </button>
              )}
              {recordingState === "recorded" && (
                <>
                  <span className="self-center text-xs text-emerald-400">
                    Recording ready — use the play buttons above to compare
                  </span>
                  <button
                    onClick={discardRecording}
                    className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-400"
                  >
                    Discard &amp; re-record
                  </button>
                </>
              )}
            </div>
            {recordingState === "idle" && (
              <p className="mt-1.5 text-xs text-zinc-500">
                Hit &ldquo;Start recording&rdquo; then play the skeleton — your
                camera rolls alongside it. When done, play steps or chunks to
                compare side by side.
              </p>
            )}
            {recordingState === "recording" && (
              <p className="mt-1.5 text-xs text-zinc-500">
                Recording… play the skeleton now and dance along.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
