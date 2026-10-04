// Speak one sentence through OpenRouter and write the audio to a file — the
// quickest check that the key, model and voice work, with no Mongo, queue or
// admin page involved. Also lists the speech models with --models.
//
//   cd worker && yarn speak "Testing the house voice." --model hexgrad/kokoro-82m --voice af_heart --out /tmp/t.mp3
//   cd worker && yarn speak --models
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { writeFileSync } from "node:fs";
import { speakable } from "@photonsurge/shared/speakable";
import { mp3DurationMs } from "@photonsurge/shared/mp3-duration";
import { DEFAULT_VOICE, pricePerHour } from "@photonsurge/shared/presenter";
import { listSpeechModels, speak } from "../lib/openrouter-speech";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

(async () => {
  if (args.includes("--models")) {
    for (const m of await listSpeechModels()) {
      console.log(`${m.id}  voices=${m.voices.length}  ~$${pricePerHour(m.pricing) ?? "?"}/hour  pricing=${JSON.stringify(m.pricing)}`);
      if (m.voices.length) console.log(`    ${m.voices.slice(0, 12).join(", ")}${m.voices.length > 12 ? ", …" : ""}`);
    }
    return;
  }
  const text = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "Testing the house voice.";
  const input = speakable(text);
  const res = await speak({
    model: flag("model") ?? DEFAULT_VOICE.model,
    input,
    voice: flag("voice") ?? null,
    speed: flag("speed") ? Number(flag("speed")) : undefined,
  });
  console.log("sent", JSON.stringify(res.body));
  if (!res.ok) throw new Error(res.error);
  const out = flag("out") ?? "/tmp/speak.mp3";
  writeFileSync(out, res.audio);
  console.log(`wrote ${out}: ${res.audio.length} bytes, ${res.contentType}, ${mp3DurationMs(res.audio)} ms, ${res.latencyMs} ms latency, generation ${res.generationId ?? "?"}`);
})()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[speak] failed:", err?.message ?? err);
    process.exit(1);
  });
