// satimg/bake.ts
// Node side of the Himawari-9 bake: spawn the satpy sidecar (himawari.py), which
// downloads the latest full-disk scan, reprojects it to a global plate-carrée PNG,
// and prints one JSON metadata line. The actual child_process call is isolated
// behind `runPython` so tests can mock it (mirrors grib/wgrib2.ts's runWgrib2).

import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";

/** Repo root — worker/src/satimg → ../../.. (matches checkMapAlignment's ROOT). */
const REPO_ROOT = resolve(__dirname, "../../..");

/**
 * Resolve the configured Python interpreter. A bare command ("python3") is left for
 * PATH lookup; a RELATIVE path (e.g. "worker/.venv-satimg/bin/python") is resolved
 * against the REPO ROOT — not the process cwd, which `yarn --cwd worker` sets to
 * worker/ and would mis-resolve a repo-root-relative venv path (the ENOENT trap).
 */
export function resolvePython(p: string): string {
  if (isAbsolute(p) || !p.includes("/")) return p;
  return resolve(REPO_ROOT, p);
}

/** Metadata the sidecar prints on stdout (one JSON line). */
export interface SatImgBakeMeta {
  satId: string;
  satName: string;
  subLon: number;
  composite: string;
  /** ISO scan-slot time. */
  observationTime: string;
  bounds: [number, number, number, number];
  width: number;
  height: number;
  /** Slot key YYYYMMDDHHMM (UTC) — for logs. */
  slot: string;
}

export interface SatImgBakeResult {
  meta: SatImgBakeMeta;
  png: Buffer;
}

export interface RunPythonArgs {
  python: string;
  args: string[];
  timeoutMs: number;
}

/** Low-level, mockable spawn. Resolves with the child's stdout (utf8). */
export function runPython({ python, args, timeoutMs }: RunPythonArgs): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      python,
      args,
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          // Surface the sidecar's stderr (its logs) on failure so the worker log
          // shows WHY the bake failed, not just a bare non-zero exit.
          (err as Error & { stderr?: string }).stderr = stderr;
          return reject(err);
        }
        resolve(stdout);
      },
    );
  });
}

export interface BakeHimawariOptions {
  /** Bird slug passed to the sidecar (default "himawari9"). */
  satellite?: string;
  /** Python interpreter — point at the satpy venv via SATIMG_PYTHON. */
  python?: string;
  /** Absolute path to himawari.py (defaults next to this module). */
  script?: string;
  /** satpy composite / band (default from SATIMG_COMPOSITE or "true_color"). */
  composite?: string;
  /** Output grid resolution in degrees (default from SATIMG_RESOLUTION or 0.05). */
  resolution?: number;
  /** Child timeout — downloads + resample can take a while (default 8 min). */
  timeoutMs?: number;
  /** Injectable spawn (tests). */
  runner?: (a: RunPythonArgs) => Promise<string>;
  /** Injectable PNG reader (tests). */
  readPng?: (path: string) => Promise<Buffer>;
}

/** Parse the sidecar's stdout: the LAST non-empty line is the JSON metadata. */
export function parseBakeMeta(stdout: string): SatImgBakeMeta {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) throw new Error("himawari.py produced no output");
  let meta: SatImgBakeMeta;
  try {
    meta = JSON.parse(last);
  } catch {
    throw new Error(`himawari.py stdout was not JSON: ${last.slice(0, 200)}`);
  }
  if (!meta.satId || !meta.width || !meta.height) {
    throw new Error(`himawari.py metadata missing fields: ${last.slice(0, 200)}`);
  }
  return meta;
}

/**
 * Run the sidecar and return the baked frame's metadata + PNG bytes. The sidecar
 * writes the PNG to a temp path we hand it, prints metadata to stdout; we read the
 * bytes back and delete the temp file. Everything upstream (S3 listing, download,
 * satpy reproject) happens inside the child — the worker just orchestrates.
 */
export async function bakeHimawari(opts: BakeHimawariOptions = {}): Promise<SatImgBakeResult> {
  const satellite = opts.satellite ?? "himawari9";
  const python = resolvePython(opts.python ?? process.env.SATIMG_PYTHON ?? "python3");
  // himawari.py is a source asset — `tsc` does NOT copy it into dist/, so a compiled
  // run (node dist) finds nothing beside __dirname. Prefer the co-located script
  // (ts-node dev, or a build that copies it), else fall back to the repo source path.
  const script =
    opts.script ??
    (existsSync(join(__dirname, "himawari.py"))
      ? join(__dirname, "himawari.py")
      : resolve(REPO_ROOT, "worker/src/satimg/himawari.py"));
  const composite = opts.composite ?? process.env.SATIMG_COMPOSITE ?? "true_color";
  const resolution = opts.resolution ?? Number(process.env.SATIMG_RESOLUTION || 0.05);
  const timeoutMs = opts.timeoutMs ?? Number(process.env.SATIMG_TIMEOUT_MS || 8 * 60 * 1000);
  const runner = opts.runner ?? runPython;
  const readPng = opts.readPng ?? readFile;

  // Fail fast with a pointer to setup when the real spawn can't find the venv,
  // instead of a bare "spawn … ENOENT". Skipped when a runner is injected (tests).
  if (!opts.runner && python.includes("/") && !existsSync(python)) {
    throw new Error(
      `satpy interpreter not found: ${python} — create the venv + set SATIMG_PYTHON (see worker/WORKER.md "Satellite imagery (satpy sidecar)")`,
    );
  }

  // Unique temp path per run so concurrent birds never clobber each other. No
  // Date.now(): use the slug + pid, which is enough to disambiguate in-process.
  const out = join(tmpdir(), `satimg-${satellite}-${process.pid}.png`);

  const args = [
    script,
    "--out",
    out,
    "--satellite",
    satellite,
    "--composite",
    composite,
    "--resolution",
    String(resolution),
  ];

  const stdout = await runner({ python, args, timeoutMs });
  const meta = parseBakeMeta(stdout);
  const png = await readPng(out);
  await unlink(out).catch(() => {
    /* temp cleanup is best-effort */
  });
  if (!png.length) throw new Error("himawari.py wrote an empty PNG");
  return { meta, png };
}
