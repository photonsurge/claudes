// weather/frameDecode.ts
// Decode an archived WeatherFrame's PNG Buffer into a FrameLike the
// weather/sample.ts helpers (sampleFrame/areaStatsFrame) can read directly —
// the worker-side counterpart of public/src/lib/weather-history.ts's
// frameToSampleable (same sharp(...).ensureAlpha().raw() approach; sharp is
// already a worker dependency via the grib bake pipeline).
import sharp from "sharp";
import "./sharp-config"; // side-effect: cap the libvips op cache (RSS)
import { withDecodeGate } from "./decodeGate";
import { bufferOf } from "@photonsurge/shared/utill/buffer";
import type { FrameLike } from "@photonsurge/shared/weather/sample";

export interface DecodableFrame {
  data: Buffer;
  bounds: number[];
  grid: { width: number; height: number; res: number };
  encoding: "scalar" | "uv";
  imageUnscale?: [number, number];
  vectorUnscale?: [number, number];
}

export async function decodeFrame(frame: DecodableFrame): Promise<FrameLike> {
  // Gate the actual libvips decode: at most SHARP_DECODE_CONCURRENCY run at once
  // process-wide, so the single BullMQ queue (concurrency 10) can't fan a dozen
  // decodes × cores threads and ratchet RSS via glibc's per-thread arenas.
  const { data, info } = await withDecodeGate(() =>
    sharp(bufferOf(frame.data)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  );
  return {
    rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
    bounds: frame.bounds,
    res: frame.grid.res,
    encoding: frame.encoding,
    imageUnscale: frame.imageUnscale,
    vectorUnscale: frame.vectorUnscale,
  };
}
