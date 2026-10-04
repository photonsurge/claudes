// import OpenAI from "openai";

// export const runtime = "nodejs"; // ensure Node runtime (not edge)

// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// export async function POST(req: Request) {
//   try {
//     const formData = await req.formData();
//     const file = formData.get("audio");

//     if (!(file instanceof File)) {
//       return Response.json({ error: "Missing 'audio' file" }, { status: 400 });
//     }

//     // Send straight to OpenAI – no saving to disk, no ffmpeg, no extra steps.
//     const result = await client.audio.transcriptions.create({
//       file,
//       language: "en",                  // 🔒 LOCK TO ENGLISH
//       model: "gpt-4o-mini-transcribe", // swap to "gpt-4o-transcribe" for max accuracy
//       // language: "en", // optional, can help if always English
//     });
//     console.log(result)

//     return Response.json({ text: result.text });
//   } catch (err: any) {
//     return Response.json(
//       { error: err?.message ?? "Transcription failed" },
//       { status: 500 }
//     );
//   }
// }


export const runtime = "nodejs";

const WORKER_URL = process.env.ASR_WORKER_URL || "http://localhost:3002/transcribe";

export async function POST(req: Request) {

  console.log("r")
  const formData = await req.formData();
  const file = formData.get("audio");

  console.log(file)
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing 'audio' file" }, { status: 400 });
  }

  // forward to worker (no processing here)
  const fd = new FormData();
  fd.set("audio", file, file.name || "audio.webm");
  fd.set("language", "en"); // optional
  fd.set("vad_filter", "true");

  const r = await fetch(WORKER_URL, { method: "POST", body: fd });
  const body = await r.text();

  console.log(body)
  return new Response(body, {
    status: r.status,
    headers: { "content-type": r.headers.get("content-type") || "application/json" },
  });
}
