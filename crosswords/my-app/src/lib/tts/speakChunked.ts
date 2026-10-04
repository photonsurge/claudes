const splitSentences = (t: string) =>
    t.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/g).filter(Boolean);

const fetchAudioArrayBuffer = async (sentence: string) => {
    const fd = new FormData();
    fd.append("text", sentence);
    fd.append("language", "en");

    const res = await fetch("/api/tts", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());

    return await res.arrayBuffer();
};

let sharedCtx: AudioContext | null = null;

// Plays a single sentence (arrayBuffer -> decoded -> play)
const playBuffer = async (ab: ArrayBuffer) => {
    if (!sharedCtx) sharedCtx = new AudioContext();

    // 🔑 This is the “autoplay unlock” equivalent in OBS/Chromium
    if (sharedCtx.state !== "running") {
        await sharedCtx.resume();
    }

    const audioBuffer = await sharedCtx.decodeAudioData(ab.slice(0));

    await new Promise<void>((resolve) => {
        const src = sharedCtx!.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(sharedCtx!.destination);
        src.onended = () => resolve();
        src.start(0);
    });
};

let lastSpoken = "";
let lastAt = 0;

export const speakChunked = async (text: string) => {
    const now = Date.now();

    if (text === lastSpoken && now - lastAt < 1000) return Promise.resolve();

    const sentences = splitSentences(text);
    for (const s of sentences) {
        const ab = await fetchAudioArrayBuffer(s);
        await playBuffer(ab);
    }
};
