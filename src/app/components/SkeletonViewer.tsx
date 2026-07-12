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

  type LearningPhase =
    | { kind: "idle" }
    | { kind: "learning"; stepIndex: number }
    | { kind: "runTogether"; upToIndex: number; nextStepIndex: number | null }
    | { kind: "done" };
  const [learningPhase, setLearningPhase] = useState<LearningPhase>({ kind: "idle" });
  const loopingRef = useRef(false);

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
    setLearningPhase({ kind: "learning", stepIndex: 0 });
    loopingRef.current = true;
    // loopCurrentStep runs via the useEffect watching learningPhase,
    // but steps state won't have updated yet — drive it directly with generated
    const step = generated[0];
    const videoEl = videoRef.current;
    const audioEl = audioRef.current;
    if (!step || !videoEl) return;
    setPlayingStepIndex(0);
    videoEl.currentTime = step.start;
    videoEl.playbackRate = playbackRate;
    playRangeRef.current = {
      stopAt: step.end,
      onDone: () => { if (loopingRef.current) loopCurrentStep(0); },
    };
    videoEl.play().catch(() => {});
    if (audioEl) {
      audioEl.currentTime = step.start;
      audioEl.playbackRate = playbackRate;
      audioEl.play().catch(() => {});
    }
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
  function playSequence(sequence: Step[], onComplete?: () => void) {
    const videoEl = videoRef.current;
    if (!videoEl || sequence.length === 0) return;

    function playFrom(index: number) {
      if (!videoEl) return;
      const step = sequence[index];
      const isLast = index === sequence.length - 1;
      const globalIndex = steps.findIndex((s) => s.id === step.id);
      setPlayingStepIndex(globalIndex === -1 ? null : globalIndex);
      videoEl.currentTime = step.start;
      videoEl.playbackRate = playbackRate;
      playRangeRef.current = {
        stopAt: step.end,
        onDone: isLast
          ? () => { setPlayingStepIndex(null); onComplete?.(); }
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

  // --- Session 2: snowball learning loop ---

  function loopCurrentStep(stepIndex: number) {
    const step = steps[stepIndex];
    const videoEl = videoRef.current;
    if (!step || !videoEl) return;
    setPlayingStepIndex(stepIndex);
    videoEl.currentTime = step.start;
    videoEl.playbackRate = playbackRate;
    playRangeRef.current = {
      stopAt: step.end,
      onDone: () => { if (loopingRef.current) loopCurrentStep(stepIndex); },
    };
    videoEl.play().catch(() => {});
    const audioEl = audioRef.current;
    if (audioEl) {
      audioEl.currentTime = step.start;
      audioEl.playbackRate = playbackRate;
      audioEl.play().catch(() => {});
    }
  }

  function handleWatchAgain() {
    if (learningPhase.kind !== "learning") return;
    loopCurrentStep(learningPhase.stepIndex);
  }

  function handleIveGotIt() {
    if (learningPhase.kind !== "learning") return;
    const { stepIndex } = learningPhase;
    loopingRef.current = false;
    videoRef.current?.pause();
    audioRef.current?.pause();
    const isLast = stepIndex === steps.length - 1;
    if (stepIndex === 0 && !isLast) {
      // First step done — go straight to step 2, no run-together yet
      setLearningPhase({ kind: "learning", stepIndex: 1 });
    } else {
      // Run everything learned so far, then advance
      setLearningPhase({
        kind: "runTogether",
        upToIndex: stepIndex,
        nextStepIndex: isLast ? null : stepIndex + 1,
      });
    }
  }

  function handleReplayStep(stepIndex: number) {
    loopingRef.current = true;
    setLearningPhase({ kind: "learning", stepIndex });
  }

  // Drive playback whenever learningPhase changes
  useEffect(() => {
    if (learningPhase.kind === "learning") {
      loopingRef.current = true;
      loopCurrentStep(learningPhase.stepIndex);
    } else if (learningPhase.kind === "runTogether") {
      loopingRef.current = false;
      const { upToIndex, nextStepIndex } = learningPhase;
      playSequence(steps.slice(0, upToIndex + 1), () => {
        if (nextStepIndex === null) {
          setLearningPhase({ kind: "done" });
        } else {
          setLearningPhase({ kind: "learning", stepIndex: nextStepIndex });
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learningPhase]);

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
            {learningStarted && learningPhase.kind === "learning" && (
              <div className="pointer-events-none absolute top-3 left-0 right-0 flex justify-center">
                <span className="rounded bg-black/70 px-3 py-1 text-sm font-medium text-white">
                  Step {learningPhase.stepIndex + 1} of {steps.length}
                </span>
              </div>
            )}
            {learningStarted && learningPhase.kind === "runTogether" && (
              <div className="pointer-events-none absolute top-3 left-0 right-0 flex justify-center px-4">
                <span className="rounded bg-indigo-900/80 px-3 py-1 text-center text-sm font-medium text-indigo-200">
                  Now let&apos;s put it all together from the top
                </span>
              </div>
            )}
          </div>
          {/* Live beat count — individual numbers highlighted as each beat hits */}
          {(() => {
            if (playingStepIndex === null) return null;
            const ps = steps[playingStepIndex];
            if (!ps || !ps.count || ps.count < 1) return null;
            // Find which beats belong to this step using the detected timestamps (ms)
            const stepStartMs = ps.start * 1000;
            const stepEndMs = ps.end * 1000;
            const stepBeats = beatTimestamps.filter(
              (t) => t >= stepStartMs && t < stepEndMs
            );
            const nowMs = currentTime * 1000;
            // Which beat number are we on? (1-indexed)
            let activeBeat = 0;
            for (let i = 0; i < stepBeats.length; i++) {
              if (nowMs >= stepBeats[i]) activeBeat = i + 1;
            }
            const totalBeats = ps.count;
            return (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {Array.from({ length: totalBeats }, (_, i) => (
                  <span
                    key={i}
                    className={`text-2xl font-bold tabular-nums transition-colors ${
                      activeBeat === i + 1
                        ? "text-white scale-125 inline-block"
                        : "text-zinc-600"
                    }`}
                  >
                    {i + 1}
                  </span>
                ))}
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

      {/* Learning loop UI */}
      {learningStarted && learningPhase.kind !== "idle" && (
        <div className="flex w-full max-w-xl flex-col items-center gap-5">

          {learningPhase.kind === "runTogether" && (
            <p className="text-center text-sm text-indigo-300">
              Watch the whole sequence — this is how it all connects.
            </p>
          )}

          {learningPhase.kind === "done" && (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-lg font-semibold text-emerald-400">You ran the whole thing!</p>
              <button
                onClick={() => handleReplayStep(0)}
                className="rounded bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Practice again from Step 1
              </button>
            </div>
          )}

          {learningPhase.kind === "learning" && (
            <div className="flex gap-3">
              <button
                onClick={handleWatchAgain}
                className="rounded border border-zinc-600 px-5 py-2.5 text-sm font-medium text-white hover:border-zinc-400"
              >
                Watch Again
              </button>
              <button
                onClick={handleIveGotIt}
                className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                I&apos;ve Got It
              </button>
            </div>
          )}

          {/* Progress row — tap any learned step to replay it */}
          {(() => {
            const learnedUpTo =
              learningPhase.kind === "learning" ? learningPhase.stepIndex
              : learningPhase.kind === "runTogether" ? learningPhase.upToIndex
              : steps.length - 1;
            if (learnedUpTo < 0) return null;
            return (
              <div className="flex flex-wrap justify-center gap-1.5">
                {steps.slice(0, learnedUpTo + 1).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => handleReplayStep(i)}
                    title={`Replay step ${i + 1}`}
                    className={`h-8 w-8 rounded-full text-xs font-medium transition-colors ${
                      learningPhase.kind === "learning" && learningPhase.stepIndex === i
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
