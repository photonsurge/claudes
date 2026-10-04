import { DirectorConfigSchema } from "./director-config-model";
import {
  DEFAULT_DIRECTOR_CONFIG,
  QUAKE_LEVELS,
  SEGMENT_KINDS,
  STORM_LEVELS,
  VOLCANO_LEVELS,
  type DirectorConfig,
} from "../director";

describe("DirectorConfigSchema", () => {
  // Same guard as broadcast-state-model.test.ts: the schema is strict, so a
  // DirectorConfig field missing here is SILENTLY dropped on write — it works
  // until the worker re-reads the doc, then reverts to the default.
  const paths = Object.keys(DirectorConfigSchema.paths);
  const topLevel = new Set(paths.map((p) => p.split(".")[0]));

  // Every optional field too, so a new optional one can't slip past the
  // DEFAULT_DIRECTOR_CONFIG-only check.
  const full: Required<DirectorConfig> = {
    ...DEFAULT_DIRECTOR_CONFIG,
    script: { scriptId: "s1", fromClip: 2, playNonce: 3, record: false },
  };

  it("persists every DirectorConfig field (strict mode drops unknown keys)", () => {
    const missing = Object.keys(full).filter((k) => !topLevel.has(k));
    expect(missing).toEqual([]);
  });

  it("persists every field of the script play trigger", () => {
    const missing = Object.keys(full.script).filter((k) => !paths.includes(`script.${k}`));
    expect(missing).toEqual([]);
  });

  it("has an explicit path for every key of the fixed per-kind/per-level maps", () => {
    const want = [
      ...SEGMENT_KINDS.map((k) => `kinds.${k}`),
      ...SEGMENT_KINDS.map((k) => `kindHoldSeconds.${k}`),
      ...QUAKE_LEVELS.map((k) => `quakeHoldSeconds.${k}`),
      ...STORM_LEVELS.map((l) => `stormHoldSeconds.${l.key}`),
      ...VOLCANO_LEVELS.map((l) => `volcanoHoldSeconds.${l.key}`),
    ];
    expect(want.filter((p) => !paths.includes(p))).toEqual([]);
  });

  it("accepts every DirectorMode in the mode enum", () => {
    const modePath = DirectorConfigSchema.path("mode") as unknown as { enumValues: string[] };
    expect(modePath.enumValues).toEqual(["off", "auto", "script"]);
  });
});
