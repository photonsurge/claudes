/**
 * Drift guard: no server module (an API route, or a page/layout without
 * "use client") may import — directly or through plain modules — a module that
 * uses React hooks. `next build` refuses that ("You're importing a module that
 * depends on `useEffect` into a React Server Component module"), but jest and
 * tsc don't, so it otherwise only shows up in the production image build.
 *
 * Reads the source rather than importing it. Type-only imports are skipped
 * (they vanish at compile time), and a "use client" module ends the walk.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const SRC = join(__dirname, "..");
const IMPORT_RE = /^\s*(?:import|export)\s(?!type\s)[^;]*?from\s+["']([^"']+)["']/gms;
const HOOK_RE =
  /import\s*\{[^}]*\buse(?:State|Effect|Ref|Callback|Memo|Context|Reducer|LayoutEffect)\b[^}]*\}\s*from\s*["']react["']/;
const CLIENT_RE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

const cache = new Map<string, { client: boolean; hooks: boolean; deps: string[] }>();
function info(file: string) {
  let hit = cache.get(file);
  if (!hit) {
    const src = readFileSync(file, "utf8");
    const deps = [...src.matchAll(IMPORT_RE)].map((m) => resolve(file, m[1])).filter((d): d is string => !!d);
    hit = { client: CLIENT_RE.test(src), hooks: HOOK_RE.test(src), deps };
    cache.set(file, hit);
  }
  return hit;
}

function serverEntries(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) serverEntries(path, out);
    else if (/^(route|page|layout)\.tsx?$/.test(name) && !info(path).client) out.push(path);
  }
  return out;
}

/** The chain from `entry` to the first hook module it reaches, or null. */
function hookChain(entry: string): string[] | null {
  const seen = new Set([entry]);
  const walk = (file: string, chain: string[]): string[] | null => {
    const { client, hooks, deps } = info(file);
    if (file !== entry && client) return null;
    if (hooks) return [...chain, file];
    for (const dep of deps) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      const found = walk(dep, [...chain, file]);
      if (found) return found;
    }
    return null;
  };
  return walk(entry, []);
}

describe("server modules never import React hook modules", () => {
  it("every API route, server page and layout stays hook-free", () => {
    const offenders = serverEntries(join(SRC, "app"))
      .map(hookChain)
      .filter((c): c is string[] => !!c)
      .map((c) => c.map((f) => relative(SRC, f)).join(" -> "));
    expect(offenders).toEqual([]);
  });
});
