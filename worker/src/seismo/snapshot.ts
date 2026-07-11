/**
 * One-shot seismograph snapshot. Unlike the old always-on model (a persistent
 * SeedLink TCP connection decoding every streamed packet 24/7), this opens a
 * SeedLink session, collects a short window of waveform samples for the
 * stations near what's on air, then closes the connection and caches the
 * result to Mongo. Between snapshots the worker does no seismic work at all —
 * no socket, no decode loop, no timers. Driven by the repeatable
 * `seismo.snapshot` BullMQ job (see index.ts); the public panel/overlay reads
 * the cache (`/api/tracks/seismo`), never the live socket.
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
/** How near a focus point a station must be to earn a snapshot stream. */
const FOCUS_RADIUS_KM = Number(process.env.SEISMO_FOCUS_RADIUS_KM || 1000);
/** Cap on stations captured at once — each is a live TCP subscription, not a cheap poll. */
const MAX_STATIONS = Number(process.env.SEISMO_MAX_STATIONS || 6);
/** Magnitude floor for quakes that pull a nearby station into focus. */
const FOCUS_MIN_MAG = Number(process.env.SEISMO_FOCUS_MIN_MAG || 5.0);
/** Rolling window of samples kept per channel (seconds). */
const SAMPLE_WINDOW_SEC = Number(process.env.SEISMO_SAMPLE_WINDOW_SEC || 120);
/** How long to hold the SeedLink session open per snapshot to gather samples. */
const SNAPSHOT_WINDOW_SEC = Number(process.env.SEISMO_SNAPSHOT_WINDOW_SEC || 90);

interface ChannelBuffer {
  station: SeismoStation;
  sampleRateHz: number;
  samples: SeismoSample[];
}

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

/** The in-focus stations (nearest each focus point, deduped, capped). */
async function chooseFocusStations(db: Awaited<ReturnType<typeof getAppDb>>): Promise<SeismoStation[]> {
  const points = await focusPoints(db);
  const chosen = new Map<string, SeismoStation>();
  for (const [lng, lat] of points) {
    if (chosen.size >= MAX_STATIONS) break;
    const near = await db.seismoStations.nearMany({ lng, lat, maxKm: FOCUS_RADIUS_KM, limit: 1 });
    if (!near.length) continue;
    chosen.set(chanKey(near[0].station), near[0].station);
  }
  return [...chosen.values()];
}

function ingestRecord(rec: Buffer, buffers: Map<string, ChannelBuffer>): void {
  let decoded;
  try {
    decoded = decodeRecord(rec);
  } catch (err) {
    log(TAG, `record decode failed`, summarizeForLog(err));
    return;
  }
  const key = `${decoded.net}.${decoded.sta}.${decoded.loc}.${decoded.cha}`;
  const buf = buffers.get(key);
  if (!buf || !decoded.samples.length) return; // not a channel we asked for

  buf.sampleRateHz = decoded.sampleRateHz;
  const startT = decoded.startTime;
  const stepMs = decoded.sampleRateHz > 0 ? 1000 / decoded.sampleRateHz : 0;
  for (let i = 0; i < decoded.samples.length; i++) {
    buf.samples.push({ t: startT + i * stepMs, v: decoded.samples[i] });
  }
  const cutoff = Date.now() - SAMPLE_WINDOW_SEC * 1000;
  while (buf.samples.length && buf.samples[0].t < cutoff) buf.samples.shift();
}

/** Open SeedLink, gather ~SNAPSHOT_WINDOW_SEC of samples, close, return the buffers. */
async function collectWindow(stations: SeismoStation[]): Promise<Map<string, ChannelBuffer>> {
  const buffers = new Map<string, ChannelBuffer>();
  for (const s of stations) buffers.set(chanKey(s), { station: s, sampleRateHz: 0, samples: [] });

  const client = new SeedLinkClient({ host: SEEDLINK_HOST, port: SEEDLINK_PORT });
  const onRec = (rec: Buffer) => ingestRecord(rec, buffers);
  client.on("record", onRec);
  client.on("status", (s: string) => log(TAG, s));
  client.setChannels(stations.map((s) => ({ net: s.net, sta: s.sta, loc: s.loc, cha: s.cha })));

  await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_WINDOW_SEC * 1000));

  client.removeListener("record", onRec);
  client.stop();
  return buffers;
}

/** Persist each non-empty buffer as a cached series; returns how many were cached. */
async function flush(db: Awaited<ReturnType<typeof getAppDb>>, buffers: Map<string, ChannelBuffer>): Promise<number> {
  let cached = 0;
  for (const [key, buf] of buffers) {
    if (!buf.samples.length) continue;
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
  return cached;
}

/**
 * Take one seismograph snapshot: pick in-focus stations, capture a short
 * window of waveform, cache it. Returns counts for the job log. A no-op (no
 * connection opened) when nothing is on air / no recent significant quakes.
 */
export async function snapshotSeismo(): Promise<{ stations: number; cached: number }> {
  const db = await getAppDb();
  const stations = await chooseFocusStations(db);
  if (!stations.length) {
    log(TAG, `snapshot skipped — no stations in focus`);
    return { stations: 0, cached: 0 };
  }
  log(TAG, `snapshot capturing`, { stations: stations.length, windowSec: SNAPSHOT_WINDOW_SEC });
  const buffers = await collectWindow(stations);
  const cached = await flush(db, buffers);
  if (cached) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "seismo", count: cached } });
  log(TAG, `snapshot done`, { stations: stations.length, cached });
  return { stations: stations.length, cached };
}
