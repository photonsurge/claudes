import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { Fire } from "../fires/types";
import type { iFireModel } from "./fire-model";

const strip = (doc: any): Fire => ({
  id: doc.fireId,
  lat: doc.lat,
  lng: doc.lng,
  frp: doc.frp ?? 0,
  brightness: doc.brightness ?? 0,
  confidence: doc.confidence ?? 0,
  acqTime: new Date(doc.acqTime).getTime(),
  daynight: doc.daynight === "D" ? "D" : doc.daynight === "N" ? "N" : "",
  satellite: doc.satellite ?? "",
});

/**
 * Active-fire persistence + overlay reads. `upsertMany` dedups on the minted
 * `fireId` (a re-poll of an overlapping window refreshes without duplicating);
 * `list` returns detections newest-first, optionally clipped by FRP and bbox. By
 * default it returns EVERYTHING (no limit) — the whole planet's fires.
 */
export function makeFireRepo(model: Model<iFireModel>) {
  return {
    model,

    /** Upsert a batch of fires on `fireId`. Fills the GeoJSON `loc`. */
    async upsertMany(fires: Fire[]): Promise<{ upserted: number; matched: number }> {
      if (!fires.length) return { upserted: 0, matched: 0 };
      const fetchedAt = new Date();
      const ops = fires.map((f) => ({
        updateOne: {
          filter: { fireId: f.id },
          update: {
            $set: {
              lat: f.lat,
              lng: f.lng,
              frp: f.frp,
              brightness: f.brightness,
              confidence: f.confidence,
              acqTime: new Date(f.acqTime),
              daynight: f.daynight,
              satellite: f.satellite,
              fetchedAt,
              loc: { type: "Point" as const, coordinates: [f.lng, f.lat] as [number, number] },
            },
            $setOnInsert: { id: uuidv4() },
          },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Recent fires (newest first), optionally filtered by FRP/bbox. */
    async list(opts: {
      minFrp?: number;
      bbox?: [number, number, number, number];
      limit?: number;
    } = {}): Promise<Fire[]> {
      const q: Record<string, unknown> = {};
      if (typeof opts.minFrp === "number") q.frp = { $gte: opts.minFrp };
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        q.loc = {
          $geoWithin: { $geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
        };
      }
      // limit(0) = no cap: show every fire by default.
      let query = model.find(q).sort({ acqTime: -1 }).limit(opts.limit ?? 0);
      // Force the geo index on bbox reads so the planner skips its multi-plan
      // trial run (else it may walk `fire_time_frp_ix` geo-filtering and burn
      // 100ms+ of planningTimeMicros, replanning across differing box sizes).
      if (opts.bbox) query = query.hint("fire_geo_ix");
      const docs = await query.lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type FireRepo = ReturnType<typeof makeFireRepo>;
