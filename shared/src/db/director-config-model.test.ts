import { DirectorConfigSchema } from "./director-config-model";
import { DEFAULT_DIRECTOR_CONFIG } from "../director";

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
  // Guards the persist path: the schema is strict (Mongoose default), so any
  // DirectorConfig field missing here is SILENTLY dropped on write — it works
  // for the request that set it, then reverts on the next read. A Mixed path
  // persists its whole subtree, so it covers every leaf beneath it.
  it("persists every DirectorConfig path (strict mode drops unknown keys)", () => {
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
