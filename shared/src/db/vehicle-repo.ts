import type { Model, FilterQuery } from "mongoose";
import { iVehicle, iVehicleModel, VehicleKind, vehicleId } from "./vehicle-model";

/**
 * Repo for the persistent vehicle registry. Reads return plain lean docs (no
 * _id/__v). The snapshot jobs feed it via `recordSightings` (one bulk upsert per
 * frame); the enrich job + admin write curation/enrichment; the public routes +
 * director read it.
 */

const CLEAN = { _id: 0, __v: 0 } as const;
const strip = <T>(d: any): T => d as T;

/** A single observed craft in a frame — the identity we persist on sighting. */
export interface Sighting {
  kind: VehicleKind;
  code: string;
  name?: string;
  country?: string;
  flag?: string;
  registration?: string;
  lng: number;
  lat: number;
}

export interface ListOpts {
  kind?: VehicleKind;
  /** true = only notable; false = only non-notable; undefined = all. */
  notable?: boolean;
  /** Case-insensitive substring over label/name/code. */
  q?: string;
  limit?: number;
  sort?: Record<string, 1 | -1>;
}

export function makeVehicleRepo(model: Model<iVehicleModel>) {
  return {
    model,

    /** One vehicle by id (`${kind}:${code}`), or null. */
    async get(id: string): Promise<iVehicle | null> {
      const doc = await model.findOne({ id }, CLEAN).lean().exec();
      return doc ? strip<iVehicle>(doc) : null;
    },

    /** One vehicle by kind + code. */
    async getByCode(kind: VehicleKind, code: string): Promise<iVehicle | null> {
      return this.get(vehicleId(kind, code));
    },

    /** Browse the registry (recency by default). Search/filter for the admin list. */
    async list(opts: ListOpts = {}): Promise<iVehicle[]> {
      const query: FilterQuery<iVehicleModel> = {};
      if (opts.kind) query.kind = opts.kind;
      if (typeof opts.notable === "boolean") query.notable = opts.notable;
      if (opts.q) {
        const rx = new RegExp(opts.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        (query as Record<string, unknown>).$or = [{ label: rx }, { name: rx }, { code: rx }];
      }
      let q = model.find(query, CLEAN).sort(opts.sort ?? { lastSeen: -1 });
      if (opts.limit && opts.limit > 0) q = q.limit(opts.limit);
      const docs = await q.lean().exec();
      return docs.map((d) => strip<iVehicle>(d));
    },

    /** Enabled notable vehicles — the director's boost catalog. */
    async notableCatalog(): Promise<iVehicle[]> {
      const docs = await model.find({ notable: true, enabled: true }, CLEAN).lean().exec();
      return docs.map((d) => strip<iVehicle>(d));
    },

    /** Ids (`${kind}:${code}`) of enabled notable craft — for marking which live
     *  rows to append a persistent trail point for. */
    async notableIds(): Promise<Set<string>> {
      const docs = await model.find({ notable: true, enabled: true }, { id: 1, _id: 0 }).lean().exec();
      return new Set(docs.map((d: any) => d.id as string));
    },

    /**
     * Persist a frame of sightings: upsert each craft's identity + lifecycle
     * (firstSeen on insert, lastSeen/last position + timesSeen++ on every frame).
     * For ids in `trailIds`, also append the point to the capped `path` breadcrumb.
     * One bulkWrite for the whole frame.
     */
    async recordSightings(
      rows: Sighting[],
      opts: { at: Date; trailIds?: Set<string>; pathCap?: number } = { at: new Date() },
    ): Promise<number> {
      if (!rows.length) return 0;
      const at = opts.at;
      const cap = opts.pathCap && opts.pathCap > 0 ? opts.pathCap : 10_000;
      const trail = opts.trailIds ?? new Set<string>();

      const ops = rows.map((r) => {
        const id = vehicleId(r.kind, r.code);
        const set: Record<string, unknown> = { lastSeen: at, lastLng: r.lng, lastLat: r.lat };
        if (r.name) set.name = r.name;
        if (r.country) set.country = r.country;
        if (r.flag) set.flag = r.flag;
        if (r.registration) set.registration = r.registration;
        const update: Record<string, unknown> = {
          $setOnInsert: { id, kind: r.kind, code: r.code.toLowerCase(), firstSeen: at },
          $set: set,
          $inc: { timesSeen: 1 },
        };
        if (trail.has(id)) {
          update.$push = { path: { $each: [{ lng: r.lng, lat: r.lat, t: at.getTime() }], $slice: -cap } };
        }
        return { updateOne: { filter: { id }, update, upsert: true } };
      });
      const res = await model.bulkWrite(ops, { ordered: false });
      return (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
    },

    /**
     * Upsert CURATED fields only (label/category/wikiTitle/notable/vip/enabled +
     * seed type/operator/overrides) without touching enrichment/lifecycle — used
     * by the seed + the admin "make notable / enrich" button. Re-runnable.
     */
    async upsertCurated(v: Partial<iVehicle> & { kind: VehicleKind; code: string }): Promise<iVehicle | null> {
      const id = vehicleId(v.kind, v.code);
      const set: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (val !== undefined && k !== "kind" && k !== "code" && k !== "id") set[k] = val;
      }
      const doc = await model
        .findOneAndUpdate(
          { id },
          { $set: set, $setOnInsert: { id, kind: v.kind, code: v.code.toLowerCase() } },
          { new: true, upsert: true, setDefaultsOnInsert: true, projection: CLEAN },
        )
        .lean()
        .exec();
      return doc ? strip<iVehicle>(doc) : null;
    },

    /** Apply an enrichment patch (photo/blurb/type/operator/*FetchedAt) by id. */
    async patch(id: string, patch: Partial<iVehicle>): Promise<void> {
      const set: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
      if (!Object.keys(set).length) return;
      await model.updateOne({ id }, { $set: set }).exec();
    },

    /** The persisted breadcrumb ("route") for a vehicle, oldest→newest. */
    async route(id: string): Promise<iVehiclePointOut[]> {
      const doc = await model.findOne({ id }, { path: 1, _id: 0 }).lean().exec();
      const path = (doc as any)?.path;
      return Array.isArray(path) ? path : [];
    },

    async remove(id: string): Promise<boolean> {
      const res = await model.deleteOne({ id }).exec();
      return (res.deletedCount ?? 0) > 0;
    },

    /** Registry size (all craft ever seen). */
    async count(query: FilterQuery<iVehicleModel> = {}): Promise<number> {
      return Object.keys(query).length ? model.countDocuments(query) : model.estimatedDocumentCount();
    },
  };
}

type iVehiclePointOut = { lng: number; lat: number; t: number };

export type VehicleRepo = ReturnType<typeof makeVehicleRepo>;
