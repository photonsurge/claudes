// weather/download.ts
// Download a GRIB subset to a temp file. Network is isolated here so ingest can
// be reasoned about / mocked separately.

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Download `url` to a temp file and return its path. Caller must clean up. */
export async function downloadToTemp(url: string, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gfs-"));
  const path = join(dir, name);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path, buf);
  return path;
}

/** Best-effort recursive cleanup of a downloaded temp file's directory. */
export async function cleanupTemp(path: string): Promise<void> {
  try {
    const dir = join(path, "..");
    await rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Default availability probe used by latestAvailableRun in production. */
export async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}
