import OpenAI from "openai";
import * as fs from "fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import "dotenv/config";
const MODEL =
  process.env.MYSTERY_MODEL ??
  process.env.OPENAI_MODEL ??
  "gpt-4o-mini";
const IMAGE_MODEL = process.env.MYSTERY_IMAGE_MODEL ?? "gpt-image-1";
const CHARACTER_IMAGE_SIZE = process.env.CHARACTER_IMAGE_SIZE ?? "1024x1024";
const CHARACTER_IMAGE_VARIANTS = Number(process.env.CHARACTER_IMAGE_VARIANTS ?? "3");
const CHARACTER_IMAGE_OUTPUT_DIR = process.env.CHARACTER_IMAGE_OUTPUT_DIR ?? "character_images";
const LOCATION_IMAGE_SIZE = process.env.LOCATION_IMAGE_SIZE ?? "1536x1024";
const LOCATION_IMAGE_VARIANTS = Number(process.env.LOCATION_IMAGE_VARIANTS ?? "2");
const LOCATION_IMAGE_MAX = Number(process.env.LOCATION_IMAGE_MAX ?? "6");
const LOCATION_IMAGE_OUTPUT_DIR = process.env.LOCATION_IMAGE_OUTPUT_DIR ?? "location_images";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017";
const MONGO_DB = process.env.MONGO_DB ?? "crossword";
const MYSTERY_COLL = process.env.MYSTERY_COLL ?? "murder_mysteries";
const execFileAsync = promisify(execFile);

const CHAPTER_SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "chapter_number",
    "chapter_title",
    "summary",
    "runtime_target_sec",
    "continuity",
    "scenes",
    "chapter_audio_plan"
  ],
  properties: {
    chapter_number: { type: "number" },
    chapter_title: { type: "string" },
    summary: { type: "string" },
    runtime_target_sec: { type: "number" },
    continuity: {
      type: "object",
      additionalProperties: false,
      required: ["must_reference_clues", "must_not_reveal", "state_in", "state_out"],
      properties: {
        must_reference_clues: { type: "array", items: { type: "string" } },
        must_not_reveal: { type: "array", items: { type: "string" } },
        state_in: {
          type: "object",
          additionalProperties: false,
          required: ["location", "known_facts"],
          properties: {
            location: { type: "string" },
            known_facts: { type: "array", items: { type: "string" } }
          }
        },
        state_out: {
          type: "object",
          additionalProperties: false,
          required: ["location", "new_facts"],
          properties: {
            location: { type: "string" },
            new_facts: { type: "array", items: { type: "string" } }
          }
        }
      }
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scene_id", "order", "location", "time", "mood", "set_state", "beats", "transitions"],
        properties: {
          scene_id: { type: "string" },
          order: { type: "number" },
          location: { type: "string" },
          time: { type: "string" },
          mood: { type: "string" },
          set_state: {
            type: "object",
            additionalProperties: false,
            required: ["weather", "lighting", "bg_sfx"],
            properties: {
              weather: { type: "string" },
              lighting: { type: "string" },
              bg_sfx: { type: "array", items: { type: "string" } }
            }
          },
          beats: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "beat_id",
                "order",
                "type",
                "actor",
                "speaker",
                "text",
                "line",
                "emotion",
                "pace_wpm",
                "duration_sec",
                "shot_hint",
                "blocking",
                "animation_tags",
                "voice",
                "subtext"
              ],
              properties: {
                beat_id: { type: "string" },
                order: { type: "number" },
                type: { type: "string", enum: ["action", "dialogue"] },
                actor: { type: ["string", "null"] },
                speaker: { type: ["string", "null"] },
                text: { type: ["string", "null"] },
                line: { type: ["string", "null"] },
                emotion: { type: ["string", "null"] },
                pace_wpm: { type: ["number", "null"] },
                duration_sec: { type: "number" },
                shot_hint: { type: "string" },
                blocking: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  required: ["from", "to", "facing"],
                  properties: {
                    from: { type: "string" },
                    to: { type: "string" },
                    facing: { type: "string" }
                  }
                },
                animation_tags: {
                  type: ["array", "null"],
                  items: { type: "string" }
                },
                voice: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  required: ["voice_id", "style", "prosody"],
                  properties: {
                    voice_id: { type: "string" },
                    style: { type: "string" },
                    prosody: { type: "string" }
                  }
                },
                subtext: { type: ["string", "null"] }
              }
            }
          },
          transitions: {
            type: "object",
            additionalProperties: false,
            required: ["in", "out"],
            properties: {
              in: { type: "string" },
              out: { type: "string" }
            }
          }
        }
      }
    },
    chapter_audio_plan: {
      type: "object",
      additionalProperties: false,
      required: ["music_cues", "sfx_cues"],
      properties: {
        music_cues: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["cue_id", "track", "start_sec", "duck_under_dialogue"],
            properties: {
              cue_id: { type: "string" },
              track: { type: "string" },
              start_sec: { type: "number" },
              duck_under_dialogue: { type: "boolean" }
            }
          }
        },
        sfx_cues: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["cue_id", "name", "start_sec", "gain_db"],
            properties: {
              cue_id: { type: "string" },
              name: { type: "string" },
              start_sec: { type: "number" },
              gain_db: { type: "number" }
            }
          }
        }
      }
    }
  }
} as const;

/* ============================================================
   INPUTS – replace or inject dynamically
   ============================================================ */

const INPUTS = {
  setting: {
    location_name: "Ravenhurst Manor",
    era: "Late Victorian / Edwardian",
    weather_containment: "A violent coastal storm. Roads flooded. Power intermittent.",
    tone_notes: [
      "Gothic elegance",
      "Social politeness masking cruelty",
      "Silence broken only by clocks and rain"
    ]
  },
  victim: {
    name: "Edgar Blackwood",
    why_hated: "Financial manipulation, blackmail, and quiet cruelty toward family and staff"
  },
  detective: {
    name: "Inspector Alistair Crowe",
    style: "Methodical, quietly observant, unnervingly patient"
  },
  characters_json: [
    {
      name: "Beatrice Blackwood",
      role: "Widow",
      notes: "Cold dignity, financially dependent on the victim",
      age_range: "mid 40s",
      appearance_hint: "Pale, angular features, severe posture",
      wardrobe_hint: "Black high-collar mourning dress, cameo brooch",
      palette_hint: "charcoal, ivory, muted silver"
    },
    {
      name: "Julian Blackwood",
      role: "Son",
      notes: "Charming, indebted gambler",
      age_range: "late 20s",
      appearance_hint: "Handsome but tired eyes, restless smile",
      wardrobe_hint: "Velvet waistcoat, loosened cravat, signet ring",
      palette_hint: "burgundy, navy, brass"
    },
    {
      name: "Clara Finch",
      role: "Secretary",
      notes: "Overworked, knows everyone’s secrets",
      age_range: "early 30s",
      appearance_hint: "Sharp gaze, ink-stained fingertips",
      wardrobe_hint: "Practical blouse and skirt, wire spectacles",
      palette_hint: "olive, cream, slate"
    },
    {
      name: "Dr. Samuel Hargreaves",
      role: "Family physician",
      notes: "Prescribes unusual medications",
      age_range: "50s",
      appearance_hint: "Neatly trimmed beard, clinical composure",
      wardrobe_hint: "Dark frock coat, leather satchel, gloves",
      palette_hint: "forest green, black, tan"
    }
  ],
  optional_clues_list: [
    "A stopped clock",
    "A misfiled ledger",
    "Wet footprints where none should be",
    "A torn letter",
    "A missing key",
    "An overheard argument"
  ]
};

/* ============================================================
   PASS 1 – OUTLINE (STRICT JSON)
   ============================================================ */

const OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "logline",
    "setting",
    "cast",
    "victim",
    "detective",
    "solution",
    "red_herrings",
    "chapter_plan",
    "clue_ledger",
    "timeline"
  ],
  properties: {
    title: { type: "string" },
    logline: { type: "string" },
    setting: {
      type: "object",
      additionalProperties: false,
      required: ["location", "era", "containment", "tone_notes"],
      properties: {
        location: { type: "string" },
        era: { type: "string" },
        containment: { type: "string" },
        tone_notes: { type: "array", items: { type: "string" } }
      }
    },
    cast: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "role",
          "public_persona",
          "private_secret",
          "relationships",
          "alibi_windows",
          "means_access",
          "appearance_summary",
          "signature_item",
          "color_palette",
          "portrait_brief"
        ],
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          public_persona: { type: "string" },
          private_secret: { type: "string" },
          relationships: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["with", "type", "note"],
              properties: {
                with: { type: "string" },
                type: { type: "string" },
                note: { type: "string" }
              }
            }
          },
          alibi_windows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["from", "to", "claim"],
              properties: {
                from: { type: "string" },
                to: { type: "string" },
                claim: { type: "string" }
              }
            }
          },
          means_access: { type: "string" },
          appearance_summary: { type: "string" },
          signature_item: { type: "string" },
          color_palette: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
          portrait_brief: { type: "string" }
        }
      }
    },
    victim: {
      type: "object",
      additionalProperties: false,
      required: ["name", "why_hated"],
      properties: {
        name: { type: "string" },
        why_hated: { type: "string" }
      }
    },
    detective: {
      type: "object",
      additionalProperties: false,
      required: ["name", "style", "blind_spot"],
      properties: {
        name: { type: "string" },
        style: { type: "string" },
        blind_spot: { type: "string" }
      }
    },
    solution: {
      type: "object",
      additionalProperties: false,
      required: ["murderer", "motive", "method", "locked_room_explanation"],
      properties: {
        murderer: { type: "string" },
        motive: { type: "string" },
        method: { type: "string" },
        locked_room_explanation: { type: "string" }
      }
    },
    red_herrings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "appears_as", "truth", "how_resolved"],
        properties: {
          label: { type: "string" },
          appears_as: { type: "string" },
          truth: { type: "string" },
          how_resolved: { type: "string" }
        }
      }
    },
    chapter_plan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chapter", "purpose", "key_scenes", "chapter_end_hook", "clues_to_seed"],
        properties: {
          chapter: { type: "number" },
          purpose: { type: "string" },
          key_scenes: { type: "array", items: { type: "string" } },
          chapter_end_hook: { type: "string" },
          clues_to_seed: { type: "array", items: { type: "string" } }
        }
      }
    },
    clue_ledger: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["clue", "planted_in_chapter", "surface_interpretation", "true_meaning"],
        properties: {
          clue: { type: "string" },
          planted_in_chapter: { type: "number" },
          surface_interpretation: { type: "string" },
          true_meaning: { type: "string" }
        }
      }
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["time", "event"],
        properties: {
          time: { type: "string" },
          event: { type: "string" }
        }
      }
    }
  }
} as const;

const OUTLINE_CORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "logline", "setting", "cast", "victim", "detective", "solution", "red_herrings", "chapter_plan"],
  properties: {
    title: OUTLINE_SCHEMA.properties.title,
    logline: OUTLINE_SCHEMA.properties.logline,
    setting: OUTLINE_SCHEMA.properties.setting,
    cast: OUTLINE_SCHEMA.properties.cast,
    victim: OUTLINE_SCHEMA.properties.victim,
    detective: OUTLINE_SCHEMA.properties.detective,
    solution: OUTLINE_SCHEMA.properties.solution,
    red_herrings: OUTLINE_SCHEMA.properties.red_herrings,
    chapter_plan: OUTLINE_SCHEMA.properties.chapter_plan
  }
} as const;

const OUTLINE_LEDGER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clue_ledger", "timeline"],
  properties: {
    clue_ledger: OUTLINE_SCHEMA.properties.clue_ledger,
    timeline: OUTLINE_SCHEMA.properties.timeline
  }
} as const;

const parseJsonContent = (content: string) => {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [unfenced];
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  }

  let parsed: unknown;
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Outline response was not a JSON object");
  }
  return parsed as Record<string, unknown>;
};

const createStructuredJson = async (
  schemaName: string,
  schema: object,
  userPrompt: string,
  maxOutputTokens: number,
  systemPrompt = "You are a meticulous murder mystery architect. Return valid JSON only and satisfy the schema exactly."
) => {
  let tokenBudget = maxOutputTokens;
  for (let attempt = 0; attempt < 4; attempt++) {
    let resp: Awaited<ReturnType<typeof client.chat.completions.create>>;
    try {
      resp = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        max_tokens: tokenBudget,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: true,
            schema: schema as Record<string, unknown>
          }
        },
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ]
      });
    } catch (err: any) {
      const msg = String(err?.error?.message ?? err?.message ?? "");
      const isMaxTokensError =
        err?.status === 400 &&
        err?.param === "max_tokens" &&
        /max_tokens|max_completion_tokens|maximum context length/i.test(msg);
      if (isMaxTokensError && attempt < 3) {
        tokenBudget = Math.max(256, Math.floor(tokenBudget * 0.7));
        console.warn(`⚠️ ${schemaName}: reducing max_tokens to ${tokenBudget} and retrying...`);
        continue;
      }
      throw err;
    }

    const content = resp.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${schemaName}: missing completion content`);
    }

    try {
      return parseJsonContent(content);
    } catch (parseErr) {
      const finishReason = resp.choices?.[0]?.finish_reason;
      if (finishReason === "length" && attempt < 3) {
        tokenBudget = Math.min(tokenBudget * 2, 12000);
        continue;
      }
      throw parseErr;
    }
  }

  throw new Error(`${schemaName}: failed to produce parseable JSON`);
};

const buildOutlinePrompt = () => `
Plan a fair-play murder mystery.

Hard constraints:
- 3 red herrings
- Locked-room-style element
- Mid-story reversal
- No new major characters after Chapter 2
- Use at least 6 optional clues

INPUTS:
SETTING: ${JSON.stringify(INPUTS.setting, null, 2)}
VICTIM: ${JSON.stringify(INPUTS.victim, null, 2)}
DETECTIVE: ${JSON.stringify(INPUTS.detective, null, 2)}
CHARACTERS: ${JSON.stringify(INPUTS.characters_json, null, 2)}
OPTIONAL CLUES: ${JSON.stringify(INPUTS.optional_clues_list, null, 2)}
`.trim();

const generateOutline = async () => {
  const basePrompt = buildOutlinePrompt();

  try {
    // Primary path: one strict schema call with larger token budget.
    return await createStructuredJson(
      "murder_mystery_outline",
      OUTLINE_SCHEMA,
      basePrompt,
      5000
    );
  } catch (err) {
    // Fallback path for huge outputs: split into core and ledger/timeline.
    console.warn("⚠️ outline single-call failed, retrying split generation...", err);

    const core = await createStructuredJson(
      "murder_mystery_outline_core",
      OUTLINE_CORE_SCHEMA,
      `${basePrompt}\n\nReturn ONLY core outline fields (no clue_ledger or timeline).`,
      4500
    );

    const ledger = await createStructuredJson(
      "murder_mystery_outline_ledger",
      OUTLINE_LEDGER_SCHEMA,
      `${basePrompt}

Core outline context:
${JSON.stringify(core, null, 2)}

Return ONLY clue_ledger and timeline consistent with the core outline above.`,
      2500
    );

    return { ...core, ...ledger };
  }
};

const generateCharacterVisuals = async (outline: Record<string, unknown>) => {
  const cast = Array.isArray((outline as { cast?: unknown }).cast)
    ? ((outline as { cast: Array<Record<string, unknown>> }).cast as Array<Record<string, unknown>>)
    : [];

  if (cast.length === 0) {
    return { characters: [] as Array<Record<string, unknown>> };
  }

  const styleVariants = [
    {
      label: "Classic Inked",
      style_tags: ["cartoon", "clean line art", "flat colors", "transparent background"],
      style_instruction:
        "Classic cartoon ink line art with flat colors only."
    },
    {
      label: "Graphic Flat",
      style_tags: ["cartoon", "graphic flat", "bold outlines", "transparent background"],
      style_instruction:
        "Graphic flat cartoon style with bold outlines and simple fills."
    },
    {
      label: "Minimal Toon",
      style_tags: ["cartoon", "minimal toon", "clean silhouette", "transparent background"],
      style_instruction:
        "Minimal toon style with clean silhouette and controlled palette."
    }
  ];

  const variantCount = Math.max(1, Math.min(CHARACTER_IMAGE_VARIANTS, styleVariants.length));
  fs.mkdirSync(CHARACTER_IMAGE_OUTPUT_DIR, { recursive: true });

  const slugify = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const asText = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
  const asTextArray = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const characters: Array<Record<string, unknown>> = [];

  for (const person of cast) {
    const characterName = asText(person.name, "Unknown");
    const role = asText(person.role, "Character");
    const appearance = asText(person.appearance_summary);
    const portraitBrief = asText(person.portrait_brief);
    const signatureItem = asText(person.signature_item);
    const palette = asTextArray(person.color_palette);
    const baseSlug = slugify(characterName || "character");
    const options: Array<Record<string, unknown>> = [];

    for (let i = 0; i < variantCount; i += 1) {
      const variant = styleVariants[i];
      const optionId = `opt_${String(i + 1).padStart(2, "0")}`;
      const prompt = `
Create a single-character cartoon portrait.

Character:
- Name: ${characterName}
- Role: ${role}
- Appearance: ${appearance || "not specified"}
- Portrait brief: ${portraitBrief || "not specified"}
- Signature item: ${signatureItem || "none"}
- Palette: ${palette.length > 0 ? palette.join(", ") : "muted victorian tones"}

Art direction:
- ${variant.style_instruction}
- Bust or half-body framing only
- Centered subject
- Transparent background (alpha). No background elements at all.
- No shadows, glows, texture overlays, particles, lens effects, or atmospheric effects.
- No text, no watermark, no logo
- No extra people
- Keep identity and costume details consistent with this story world
`.trim();

      const imageResp = await client.images.generate({
        model: IMAGE_MODEL,
        prompt,
        size: CHARACTER_IMAGE_SIZE as "1024x1024" | "1536x1024" | "1024x1536" | "auto",
        background: "transparent",
      });

      const image = imageResp.data?.[0];
      if (!image || !image.b64_json) {
        throw new Error(`Image generation failed for ${characterName} (${optionId}): missing b64 image data`);
      }

      const fileName = `${baseSlug}-${optionId}.png`;
      const filePath = `${CHARACTER_IMAGE_OUTPUT_DIR}/${fileName}`;
      fs.writeFileSync(filePath, Buffer.from(image.b64_json, "base64"));

      options.push({
        option_id: optionId,
        label: variant.label,
        style_tags: variant.style_tags,
        image_path: filePath,
        image_mime_type: "image/png",
        prompt
      });
    }

    characters.push({
      character_name: characterName,
      options
    });
  }

  return {
    image_model: IMAGE_MODEL,
    image_size: CHARACTER_IMAGE_SIZE,
    output_dir: CHARACTER_IMAGE_OUTPUT_DIR,
    characters
  };
};

const generateLocationVisuals = async (outline: Record<string, unknown>) => {
  const asText = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : fallback);
  const asTextArray = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()) : [];
  const slugify = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const setting = (outline as { setting?: Record<string, unknown> }).setting ?? {};
  const chapterPlan = Array.isArray((outline as { chapter_plan?: unknown }).chapter_plan)
    ? ((outline as { chapter_plan: Array<Record<string, unknown>> }).chapter_plan as Array<Record<string, unknown>>)
    : [];

  const rawSeeds: Array<{ location_name: string; description: string }> = [];
  const primaryLocation = asText(setting.location, "Primary Mystery Setting");
  const era = asText(setting.era);
  const containment = asText(setting.containment);
  const toneNotes = asTextArray(setting.tone_notes);

  rawSeeds.push({
    location_name: primaryLocation,
    description: [primaryLocation, era, containment, toneNotes.join(", ")].filter(Boolean).join(" | ")
  });

  for (const ch of chapterPlan) {
    const chapterNum = Number(ch.chapter);
    const scenes = asTextArray(ch.key_scenes);
    for (let i = 0; i < scenes.length; i += 1) {
      rawSeeds.push({
        location_name: `Chapter ${Number.isFinite(chapterNum) ? chapterNum : "?"} Scene ${i + 1}`,
        description: scenes[i]
      });
    }
  }

  const uniqueSeeds: Array<{ location_name: string; description: string }> = [];
  const seen = new Set<string>();
  for (const seed of rawSeeds) {
    const key = seed.description.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueSeeds.push(seed);
    if (uniqueSeeds.length >= Math.max(1, LOCATION_IMAGE_MAX)) {
      break;
    }
  }

  if (uniqueSeeds.length === 0) {
    return { locations: [] as Array<Record<string, unknown>> };
  }

  const styleVariants = [
    {
      label: "Storybook Scenic",
      style_tags: ["cartoon", "storybook", "clean lighting"],
      style_instruction: "Readable storybook-style cartoon environment with clean shapes and colors."
    },
    {
      label: "Graphic Scenic",
      style_tags: ["cartoon", "graphic", "bold composition"],
      style_instruction: "Graphic cartoon environment with bold composition and clear depth layers."
    },
    {
      label: "Cel Scenic",
      style_tags: ["cartoon", "cel-shaded", "atmospheric but clean"],
      style_instruction: "Cel-shaded cartoon environment with crisp forms and controlled contrast."
    }
  ];

  const variantCount = Math.max(1, Math.min(LOCATION_IMAGE_VARIANTS, styleVariants.length));
  fs.mkdirSync(LOCATION_IMAGE_OUTPUT_DIR, { recursive: true });

  const locations: Array<Record<string, unknown>> = [];
  for (const seed of uniqueSeeds) {
    const baseSlug = slugify(seed.location_name || "location");
    const options: Array<Record<string, unknown>> = [];

    for (let i = 0; i < variantCount; i += 1) {
      const variant = styleVariants[i];
      const optionId = `opt_${String(i + 1).padStart(2, "0")}`;
      const prompt = `
Create a cartoon background plate for a mystery story location.

Location name: ${seed.location_name}
Description: ${seed.description}

Art direction:
- ${variant.style_instruction}
- Wide establishing composition for use as a scene background
- No people or animals
- No text, watermark, logo, UI, labels
- No heavy VFX (no glow overlays, particles, lens flares, or surreal effects)
- Keep architecture/props faithful to late Victorian / Edwardian tone
`.trim();

      const imageResp = await client.images.generate({
        model: IMAGE_MODEL,
        prompt,
        size: LOCATION_IMAGE_SIZE as "1024x1024" | "1536x1024" | "1024x1536" | "auto",
      });

      const image = imageResp.data?.[0];
      if (!image || !image.b64_json) {
        throw new Error(`Image generation failed for location ${seed.location_name} (${optionId})`);
      }

      const fileName = `${baseSlug}-${optionId}.png`;
      const filePath = `${LOCATION_IMAGE_OUTPUT_DIR}/${fileName}`;
      fs.writeFileSync(filePath, Buffer.from(image.b64_json, "base64"));

      options.push({
        option_id: optionId,
        label: variant.label,
        style_tags: variant.style_tags,
        image_path: filePath,
        image_mime_type: "image/png",
        prompt
      });
    }

    locations.push({
      location_name: seed.location_name,
      location_description: seed.description,
      options
    });
  }

  return {
    image_model: IMAGE_MODEL,
    image_size: LOCATION_IMAGE_SIZE,
    output_dir: LOCATION_IMAGE_OUTPUT_DIR,
    locations
  };
};

/* ============================================================
   PASS 2 – CHAPTER SCRIPT (STRICT JSON FOR ANIMATION/TTS)
   ============================================================ */

const generateChapterScriptJson = async ({
  outlineJson,
  chapterNumber,
  priorChapterScriptJson = "",
}: {
  outlineJson: string;
  chapterNumber: number;
  priorChapterScriptJson?: string;
}) => {
  const prompt = `
Generate production-ready chapter script JSON for Chapter ${chapterNumber}.

Hard constraints:
- Keep solution, clues, timeline, and culprit consistent with outline.
- No new major characters after Chapter 2.
- Include dialogue and action beats with duration and shot hints.
- Every dialogue beat must include speaker, line, emotion, voice object.
- Include audio cues for music and sfx.
- Keep IDs deterministic-like: ch_${String(chapterNumber).padStart(2, "0")}_...

OUTLINE JSON:
${outlineJson}

PRIOR CHAPTER SCRIPT JSON (optional continuity context):
${priorChapterScriptJson || "(none)"}
`.trim();

  return await createStructuredJson(
    `chapter_script_ch_${String(chapterNumber).padStart(2, "0")}`,
    CHAPTER_SCRIPT_SCHEMA,
    prompt,
    4500
  );
};

/* ============================================================
   PASS 3 – PROSE FROM CHAPTER SCRIPT
   ============================================================ */

const generateChapterProseFromScript = async (
  chapterScriptJson: string,
  priorText = "",
  includeEnding = false
) => {
  const resp = await client.responses.create({
    model: MODEL,
    temperature: 0.8,
    max_output_tokens: includeEnding ? 4500 : 3500,
    input: [
      {
        role: "user",
        content: `
You are writing chapter prose from a locked production script JSON.

RULES:
- Do not change events, who does what, dialogue intent, clue placements, or continuity from script.
- Keep chapter voice cinematic and clear.
- Preserve scene ordering.
- End with a hook.

${includeEnding ? "After this chapter, include Evidence Ledger, Timeline, and Solution (SPOILERS)." : ""}

CHAPTER SCRIPT JSON:
${chapterScriptJson}

PRIOR TEXT:
${priorText}
`
      }
    ]
  });

  return resp.output_text!;
};

const saveMysteryToMongo = async ({
  outline,
  outlineJson,
  characterVisuals,
  locationVisuals,
  chapters,
  fullStory,
}: {
  outline: Record<string, unknown>;
  outlineJson: string;
  characterVisuals: Record<string, unknown>;
  locationVisuals: Record<string, unknown>;
  chapters: Array<{
    chapterNumber: number;
    includeEnding?: boolean;
    scriptJson: string;
    script: Record<string, unknown>;
    prose: string;
  }>;
  fullStory: string;
}) => {
  const now = new Date();
  const title =
    typeof outline.title === "string" && outline.title.trim().length > 0
      ? outline.title
      : `Untitled Mystery ${now.toISOString()}`;

  const doc = {
    kind: "murder_mystery",
    title,
    outline,
    outlineJson,
    characterVisuals,
    locationVisuals,
    story: fullStory,
    chapters,
    inputs: INPUTS,
    models: {
      outline: MODEL,
      prose: MODEL,
    },
    llm: {
      model: MODEL,
      provider: "openai",
      endpoint: process.env.OPENAI_BASE_URL ?? null,
    },
    source: {
      script: "src/murder-mystery.ts",
    },
    createdAt: now,
    updatedAt: now,
  };

  const hasDbInUri = /^mongodb(?:\+srv)?:\/\/[^/]+\/[^/?]+(?:\?.*)?$/i.test(MONGO_URI);
  const mongoTarget = hasDbInUri ? MONGO_URI : `${MONGO_URI.replace(/\/+$/, "")}/${MONGO_DB}`;
  const tmpPath = `.mystery-insert-${Date.now()}.json`;
  fs.writeFileSync(tmpPath, JSON.stringify(doc), "utf8");

  try {
    const evalScript = `
      const fs = require("fs");
      const doc = JSON.parse(fs.readFileSync(${JSON.stringify(tmpPath)}, "utf8"));
      const r = db.getCollection(${JSON.stringify(MYSTERY_COLL)}).insertOne(doc);
      print(JSON.stringify({ insertedId: String(r.insertedId) }));
    `;

    const { stdout, stderr } = await execFileAsync("mongosh", [mongoTarget, "--quiet", "--eval", evalScript], {
      maxBuffer: 1024 * 1024 * 10,
    });

    const err = stderr?.trim();
    if (err) {
      throw new Error(`mongosh stderr: ${err}`);
    }

    const lines = (stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const lastJson = lines.reverse().find((l) => l.startsWith("{") && l.endsWith("}"));
    if (!lastJson) {
      throw new Error("mongosh did not return inserted id");
    }
    const parsed = JSON.parse(lastJson) as { insertedId?: string };
    if (!parsed.insertedId) {
      throw new Error("insertedId missing from mongosh response");
    }
    return parsed.insertedId;
  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }
};

/* ============================================================
   MAIN EXECUTION
   ============================================================ */

async function main() {
  console.log(`🤖 LLM model: ${MODEL}`);
  console.log("🔍 Generating outline...");
  const outline = await generateOutline();
  const outlineJson = JSON.stringify(outline, null, 2);
  fs.writeFileSync("outline.json", outlineJson);

  console.log("🖼️ Generating character cartoon images...");
  const characterVisuals = await generateCharacterVisuals(outline);
  fs.writeFileSync("character_visuals.json", JSON.stringify(characterVisuals, null, 2));
  console.log("🏰 Generating location cartoon images...");
  const locationVisuals = await generateLocationVisuals(outline);
  fs.writeFileSync("location_visuals.json", JSON.stringify(locationVisuals, null, 2));

  const planned = Array.isArray((outline as any).chapter_plan)
    ? ((outline as any).chapter_plan as Array<{ chapter?: number }>)
        .map((c) => Number(c.chapter))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b)
    : [];
  const chapterNumbers = planned.length > 0 ? planned : [1, 2, 3, 4, 5, 6, 7, 8];

  const chapters: Array<{
    chapterNumber: number;
    includeEnding?: boolean;
    scriptJson: string;
    script: Record<string, unknown>;
    prose: string;
  }> = [];

  let priorText = "";
  let priorScriptJson = "";

  for (let i = 0; i < chapterNumbers.length; i += 1) {
    const n = chapterNumbers[i];
    const includeEnding = i === chapterNumbers.length - 1;

    console.log(`🎬 Generating chapter script JSON for Chapter ${n}...`);
    const script = await generateChapterScriptJson({
      outlineJson,
      chapterNumber: n,
      priorChapterScriptJson: priorScriptJson,
    });
    const scriptJson = JSON.stringify(script, null, 2);
    fs.writeFileSync(`chapter_${String(n).padStart(2, "0")}_script.json`, scriptJson);

    console.log(`✍️ Writing prose for Chapter ${n}${includeEnding ? " + ending artifacts" : ""}...`);
    const prose = await generateChapterProseFromScript(scriptJson, priorText, includeEnding);

    chapters.push({
      chapterNumber: n,
      includeEnding,
      scriptJson,
      script,
      prose,
    });

    priorText = [priorText, prose].filter(Boolean).join("\n\n");
    priorScriptJson = scriptJson;
  }

  const fullStory = chapters.map((c) => c.prose).join("\n\n");
  fs.writeFileSync("murder_mystery.txt", fullStory);

  console.log(`🗄️ Saving to MongoDB (${MONGO_DB}.${MYSTERY_COLL})...`);
  const insertedId = await saveMysteryToMongo({
    outline,
    outlineJson,
    characterVisuals,
    locationVisuals,
    chapters,
    fullStory,
  });
  console.log(`✅ Saved mystery to MongoDB with _id=${insertedId}`);

  console.log("✅ Murder mystery complete!");
}

main().catch(console.error);
