// Speak one sentence through OpenRouter and write the audio to a file — the
// quickest check that the key, model and voice work.
//
// By default the run is saved as a take (source "cli"), so it shows on
// /admin/presenters with the page's own tests. Its audio is written to the
// shared blob folder on this machine (`${BLOB_DIR:-./blobs}` from the repo root,
// the folder compose mounts at /app/blobs), and an identical earlier take is
// reused instead of paying again. --fresh forces new audio; --no-save skips
// Mongo entirely (just the HTTP call and the file). --models lists the models.
//
//   cd worker && yarn speak "Testing the house voice." --model hexgrad/kokoro-82m --voice af_heart --out /tmp/t.mp3
//   cd worker && yarn speak "…" --presenter house        (use a saved presenter's voice)
//   cd worker && yarn speak --models
import { loadWorkerEnv } from "../loadEnv";
import { resolveHostBlobDir } from "../lib/hostBlobDir";
loadWorkerEnv();

// Write audio into the same folder the containers mount, so a CLI take is a
// file in the shared blob dir like one made from the page. Must be set before
// the db (and its blob stores) is created.
const blobDir = resolveHostBlobDir();
if (blobDir.dir) process.env.BLOB_DIR = blobDir.dir;
else delete process.env.BLOB_DIR;

import { writeFileSync } from "node:fs";
import { getAppDb } from "@photonsurge/shared/db/index";
import { speakable } from "@photonsurge/shared/speakable";
import { mp3DurationMs } from "@photonsurge/shared/mp3-duration";
import { DEFAULT_VOICE, pricePerHour, sanitizeVoice } from "@photonsurge/shared/presenter";
import { listSpeechModels, speak } from "../lib/openrouter-speech";
import { runVoiceTest } from "../presenter/bench";

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["model", "voice", "speed", "style", "out", "presenter", "label"]);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

async function noSave(text: string, out: string) {
  const res = await speak({
    model: flag("model") ?? DEFAULT_VOICE.model,
    input: speakable(text),
    voice: flag("voice") ?? null,
    speed: flag("speed") ? Number(flag("speed")) : undefined,
  });
  console.log("sent", JSON.stringify(res.body));
  if (!res.ok) throw new Error(res.error);
  writeFileSync(out, res.audio);
  console.log(`wrote ${out}: ${res.audio.length} bytes, ${res.contentType}, ${mp3DurationMs(res.audio)} ms, ${res.latencyMs} ms latency, generation ${res.generationId ?? "?"}`);
}

async function saved(text: string, out: string) {
  const db = await getAppDb();
  try {
    const presenterId = flag("presenter") ?? null;
    const presenter = presenterId ? await db.presenters.get(presenterId) : null;
    if (presenterId && !presenter) throw new Error(`no presenter "${presenterId}"`);
    const voice = sanitizeVoice({
      ...(presenter?.voice ?? DEFAULT_VOICE),
      ...(flag("model") ? { model: flag("model"), voice: null } : {}),
      ...(flag("voice") ? { voice: flag("voice") } : {}),
      ...(flag("speed") ? { speed: Number(flag("speed")) } : {}),
      ...(flag("style") ? { style: flag("style") } : {}),
    });
    const created = await db.voiceTests.create({
      presenterId,
      label: flag("label") ?? (presenter ? `${presenter.name} (CLI)` : "CLI take"),
      text,
      voice,
      createdBy: process.env.USER ?? "cli",
      source: "cli",
      fresh: has("fresh"),
    });
    const take = await runVoiceTest(db, created.id, { ignoreSwitch: true });
    if (!take || take.status !== "ready") throw new Error(take?.error ?? "take failed");
    const audio = await db.voiceTests.getAudio(take.id);
    if (!audio) throw new Error("take has no audio");
    writeFileSync(out, audio.data);
    const a = take.audio!;
    console.log("sent", take.spoken);
    console.log(
      `wrote ${out}: ${a.bytes} bytes, ${a.durationMs} ms` +
        (take.cachedFrom
          ? ` — reused take ${take.cachedFrom}, no charge (--fresh to make new audio)`
          : `, ${a.latencyMs} ms latency, ~$${a.estCostUsd ?? "?"}, generation ${a.generationId ?? "?"}`),
    );
    const file = db.blobFs?.filePath("presenter-audio", take.id);
    console.log(
      `saved as take ${take.id} — see /admin/presenters\n` +
        (file ? `audio: ${file}` : `audio stored in Mongo (shared blob folder not used: ${blobDir.reason})`),
    );
  } finally {
    await db.conn.close();
  }
}

(async () => {
  if (has("models")) {
    for (const m of await listSpeechModels()) {
      console.log(`${m.id}  voices=${m.voices.length}  ~$${pricePerHour(m.pricing) ?? "?"}/hour  pricing=${JSON.stringify(m.pricing)}`);
      if (m.voices.length) console.log(`    ${m.voices.slice(0, 12).join(", ")}${m.voices.length > 12 ? ", …" : ""}`);
    }
    return;
  }
  const text =
    args.find((a, i) => !a.startsWith("--") && !(args[i - 1]?.startsWith("--") && VALUE_FLAGS.has(args[i - 1].slice(2)))) ??
    "Testing the house voice.";
  const out = flag("out") ?? "/tmp/speak.mp3";
  await (has("no-save") ? noSave(text, out) : saved(text, out));
})()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[speak] failed:", err?.message ?? err);
    process.exit(1);
  });
