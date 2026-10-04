type ChunkHandler = (chunk: Blob, index: number) => Promise<void>;

export const assertVoiceBrowser = () => {
  const ua = navigator.userAgent.toLowerCase();
  const isFirefox = ua.includes("firefox");

  if (isFirefox) {
    alert("Voice capture (prototype) isn't supported in Firefox.\n\nUse Chrome or Edge for now.");
    return false;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Your browser doesn't support microphone capture (getUserMedia).");
    return false;
  }
  if (typeof MediaRecorder === "undefined") {
    alert("Your browser doesn't support MediaRecorder.");
    return false;
  }
  return true;
};


export const smartJoin = (a: string, b: string) => {
  const A = (a ?? "").trimEnd();   // keep trailing char
  const B = (b ?? "").trimStart(); // keep leading char
  if (!A) return B.trim();
  if (!B) return A.trim();

  const last = A.slice(-1);
  const first = B.slice(0, 1);

  const isWordChar = (c: string) => /[A-Za-z0-9]/.test(c);

  // If chunk split happened mid-word: "electri" + "city" => "electricity"
  if (isWordChar(last) && isWordChar(first)) {
    return (A + B).trim();
  }

  // Normal case: separate with a space
  return (A + " " + B).trim();
};
type SegmentHandler = (segment: Blob, index: number) => Promise<void>;

export const recordSegmentsBySilence = async ({
  onSegment,

  // VAD tuning
  threshold = 0.018,
  hysteresis = 0.006,
  silenceMsToCut = 650,
  maxSegmentMs = 12000,

  tickMs = 60,
}: {
  onSegment: SegmentHandler;
  threshold?: number;
  hysteresis?: number;
  silenceMsToCut?: number;
  maxSegmentMs?: number;
  tickMs?: number;
}) => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const pickMimeType = () => {
    // Prefer OGG if available (often more robust), else WebM
    const candidates = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (const t of candidates) {
      // @ts-ignore
      if (MediaRecorder.isTypeSupported?.(t)) return t;
    }
    return undefined;
  };

  const mimeType = pickMimeType();

  // RMS analyser
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const tmp = new Uint8Array(analyser.fftSize);

  const getRms = () => {
    analyser.getByteTimeDomainData(tmp);
    let sum = 0;
    for (let i = 0; i < tmp.length; i++) {
      const v = (tmp[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / tmp.length);
  };

  let stopped = false;
  let index = 0;

  // current segment recorder
  let recorder: MediaRecorder | null = null;
  let parts: BlobPart[] = [];
  let segmentStartAt = 0;
  let lastVoiceAt = 0;
  let speaking = false;

  // serialize delivery
  let seq = Promise.resolve();

  const startNewSegment = () => {
    parts = [];
    segmentStartAt = performance.now();

    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    });

    recorder.start(); // <-- NO timeslice. This is the key.
  };

  const stopSegment = async () => {
    const r = recorder;
    if (!r) return;

    recorder = null;

    const blob = await new Promise<Blob | null>((resolve) => {
      r.addEventListener(
        "stop",
        () => {
          if (!parts.length) return resolve(null);
          resolve(new Blob(parts, { type: r.mimeType || mimeType || "audio/webm" }));
        },
        { once: true }
      );

      try {
        r.stop();
      } catch {
        resolve(null);
      }
    });

    if (blob && blob.size > 0) {
      seq = seq.then(() => onSegment(blob, index++)).catch(() => {});
      await seq;
    }

    parts = [];
    segmentStartAt = 0;
  };

  const ensureSegmentRunning = () => {
    if (!recorder) startNewSegment();
  };

  const vadLoop = async () => {
    while (!stopped) {
      const rms = getRms();
      const now = performance.now();

      // Start segment when speech begins
      if (!speaking && rms > threshold + hysteresis) {
        speaking = true;
        lastVoiceAt = now;
        ensureSegmentRunning();
      }

      if (speaking) {
        if (rms > threshold) lastVoiceAt = now;

        const segAge = segmentStartAt ? now - segmentStartAt : 0;
        const silentFor = now - lastVoiceAt;

        // Cut when silent long enough OR max segment age
        if ((silentFor >= silenceMsToCut && segAge > 0) || segAge >= maxSegmentMs) {
          speaking = false;
          await stopSegment();
        }
      }

      await new Promise((r) => setTimeout(r, tickMs));
    }
  };

  const start = () => {
    stopped = false;
    void vadLoop();
  };

  const stop = async () => {
    stopped = true;
    try {
      await stopSegment();
    } catch {}

    try {
      recorder?.stop();
    } catch {}

    stream.getTracks().forEach((t) => t.stop());
    try {
      await audioCtx.close();
    } catch {}
  };

  return { start, stop };
};
