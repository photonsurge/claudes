import { DirectorConfigSchema } from "./director-config-model";
import {
  DEFAULT_DIRECTOR_CONFIG,
  QUAKE_LEVELS,
  SEGMENT_KINDS,
  STORM_LEVELS,
  VOLCANO_LEVELS,
  type DirectorConfig,
} from "../director";

/**
 * Every leaf path of a value, dotted. Plain objects recurse; arrays and
 * primitives are leaves.
 */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [prefix];
    return entries.flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

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

  // Guards the persist path: the schema is strict (Mongoose default), so any
  // DirectorConfig field missing here is SILENTLY dropped on write — it works
  // for the request that set it, then reverts on the next read. A Mixed path
  // persists its whole subtree, so it covers every leaf beneath it.
  it("persists every leaf path of the defaults (tuning buckets included)", () => {
    const paths = DirectorConfigSchema.paths;
    const mixed = Object.keys(paths).filter((p) => paths[p].instance === "Mixed");
    const covered = (leaf: string) =>
      leaf in paths || mixed.some((m) => leaf === m || leaf.startsWith(`${m}.`));
    const missing = leafPaths(DEFAULT_DIRECTOR_CONFIG).filter((leaf) => !covered(leaf));
    expect(missing).toEqual([]);
  });

  it("defaults each fixed-shape tuning path to the shared default", () => {
    const paths = DirectorConfigSchema.paths;
    for (const key of ["rotation", "pools", "tours", "tempo"] as const) {
      for (const [field, value] of Object.entries(DEFAULT_DIRECTOR_CONFIG[key])) {
        expect([`${key}.${field}`, (paths[`${key}.${field}`] as any)?.defaultValue]).toEqual([`${key}.${field}`, value]);
      }
    }
  });
});
