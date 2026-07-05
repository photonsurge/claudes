/**
 * The live seismograph stream. Unlike the other worker jobs (BullMQ polling),
 * this keeps one persistent SeedLink TCP connection open — mirrors
 * `director/loop.ts`'s start/stop lifecycle rather than a repeatable job.
 * A slow tick recomputes which stations are "in focus" (near what's on air)
 * and reconnects the SeedLink session only when that set actually changes;
 * a fast tick flushes newly-decoded samples to Mongo so the public panel/
 * overlay reads a cache, never the live socket directly.
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import type { SeismoSample, SeismoSeries, SeismoStation } from "@photonsurge/shared/seismo/types";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { summarizeForLog } from "../utils";
import { SeedLinkClient } from "./seedlink-client";
import { decodeRecord } from "./miniseed";

const TAG = "seismo";

const SEEDLINK_HOST = process.env.SEEDLINK_HOST || "rtserve.iris.washington.edu";
const SEEDLINK_PORT = Number(process.env.SEEDLINK_PORT || 18000);
/** How near a focus point a station must be to earn a live SeedLink stream. */
const FOCUS_RADIUS_KM = Number(process.env.SEISMO_FOCUS_RADIUS_KM || 1000);
/** Cap on stations streamed at once — each is a live TCP subscription, not a cheap poll. */
const MAX_STATIONS = Number(process.env.SEISMO_MAX_STATIONS || 6);
/** Magnitude floor for quakes that pull a nearby station into focus. */
const FOCUS_MIN_MAG = Number(process.env.SEISMO_FOCUS_MIN_MAG || 5.0);
/** Rolling window of samples kept per channel (seconds). */
const SAMPLE_WINDOW_SEC = Number(process.env.SEISMO_SAMPLE_WINDOW_SEC || 120);

const FOCUS_TICK_MS = 60_000;
const FLUSH_TICK_MS = 5_000;

interface ChannelBuffer {
  station: SeismoStation;
  sampleRateHz: number;
  samples: SeismoSample[];
}

let client: SeedLinkClient | null = null;
let focusTimer: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
const buffers = new Map<string, ChannelBuffer>(); // key: net.sta.loc.cha
const dirty = new Set<string>();

const chanKey = (c: Pick<SeismoStation, "net" | "sta" | "loc" | "cha">) => `${c.net}.${c.sta}.${c.loc}.${c.cha}`;

/** [lng,lat] focus points = current on-air camera + recent significant quakes. */
async function focusPoints(db: Awaited<ReturnType<typeof getAppDb>>): Promise<[number, number][]> {
  const pts: [number, number][] = [];
  try {
    const bs: any = await db.getOrInitBroadcastState();
    const c = bs?.camera?.center;
    if (Array.isArray(c) && c.length === 2 && c.every((n: unknown) => typeof n === "number")) {
      pts.push([c[0], c[1]]);
    }
  } catch {
    /* no broadcast state yet — fall back to quakes only */
  }
  const quakes = await db.quakes.list({ minMag: FOCUS_MIN_MAG, limit: 30 });
  quakes.sort((a, b) => Number(b.tsunami) - Number(a.tsunami));
  for (const q of quakes) pts.push([q.lng, q.lat]);
  return pts;
}

async function recomputeFocus(): Promise<void> {
  try {
    const db = await getAppDb();
    const points = await focusPoints(db);
    const chosen = new Map<string, SeismoStation>();
    for (const [lng, lat] of points) {
      if (chosen.size >= MAX_STATIONS) break;
      const near = await db.seismoStations.nearMany({ lng, lat, maxKm: FOCUS_RADIUS_KM, limit: 1 });
      if (!near.length) continue;
      chosen.set(chanKey(near[0].station), near[0].station);
    }

    // Drop in-memory buffers for stations that fell out of focus.
    for (const key of [...buffers.keys()]) {
      if (!chosen.has(key)) {
        buffers.delete(key);
        dirty.delete(key);
      }
    }
    for (const [key, station] of chosen) {
      if (!buffers.has(key)) buffers.set(key, { station, sampleRateHz: 0, samples: [] });
    }

    client?.setChannels([...chosen.values()].map((s) => ({ net: s.net, sta: s.sta, loc: s.loc, cha: s.cha })));
    log(TAG, `focus recomputed`, { points: points.length, stations: chosen.size });
  } catch (err) {
    log(TAG, `focus recompute failed`, summarizeForLog(err));
  }
}

async function flush(): Promise<void> {
  if (!dirty.size) return;
  const keys = [...dirty];
  dirty.clear();
  const db = await getAppDb();
  let cached = 0;
  for (const key of keys) {
    const buf = buffers.get(key);
    if (!buf || !buf.samples.length) continue;
    const series: SeismoSeries = {
      net: buf.station.net,
      sta: buf.station.sta,
      loc: buf.station.loc,
      cha: buf.station.cha,
      lat: buf.station.lat,
      lng: buf.station.lng,
      siteName: buf.station.siteName,
      sampleRateHz: buf.sampleRateHz,
      samples: buf.samples,
      latest: buf.samples[buf.samples.length - 1].v,
      updatedAt: Date.now(),
    };
    try {
      await db.seismoSeries.upsert(series);
      cached++;
    } catch (err) {
      log(TAG, `series upsert failed for ${key}`, summarizeForLog(err));
    }
  }
  if (cached) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "seismo", count: cached } });
}

function onRecord(rec: Buffer): void {
  let decoded;
  try {
    decoded = decodeRecord(rec);
  } catch (err) {
    log(TAG, `record decode failed`, summarizeForLog(err));
    return;
  }
  const key = `${decoded.net}.${decoded.sta}.${decoded.loc}.${decoded.cha}`;
  const buf = buffers.get(key);
  if (!buf || !decoded.samples.length) return; // not (or no longer) in focus

  buf.sampleRateHz = decoded.sampleRateHz;
  const startT = decoded.startTime;
  const stepMs = decoded.sampleRateHz > 0 ? 1000 / decoded.sampleRateHz : 0;
  for (let i = 0; i < decoded.samples.length; i++) {
    buf.samples.push({ t: startT + i * stepMs, v: decoded.samples[i] });
  }
  const cutoff = Date.now() - SAMPLE_WINDOW_SEC * 1000;
  while (buf.samples.length && buf.samples[0].t < cutoff) buf.samples.shift();
  dirty.add(key);
}

/** Start the live seismograph stream. Idempotent. */
export function startSeismoStream(): void {
  if (client) return;
  client = new SeedLinkClient({ host: SEEDLINK_HOST, port: SEEDLINK_PORT });
  client.on("record", onRecord);
  client.on("status", (s: string) => log(TAG, s));
  focusTimer = setInterval(() => void recomputeFocus(), FOCUS_TICK_MS);
  flushTimer = setInterval(() => void flush(), FLUSH_TICK_MS);
  void recomputeFocus();
  log(TAG, `started`, { focusTickMs: FOCUS_TICK_MS, flushTickMs: FLUSH_TICK_MS });
}

export function stopSeismoStream(): void {
  if (focusTimer) clearInterval(focusTimer);
  if (flushTimer) clearInterval(flushTimer);
  focusTimer = null;
  flushTimer = null;
  client?.stop();
  client = null;
  buffers.clear();
  dirty.clear();
}
