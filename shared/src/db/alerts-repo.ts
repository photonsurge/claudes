import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iAlert, iAlertModel } from "./alert-model";

export interface AlertListOpts {
  activeOnly?: boolean;
  source?: string;
  /** Minimum normalised severity (0–4). */
  severityMin?: number;
  /** Only alerts whose geometry intersects this bbox [w,s,e,n] (skips geocode-only). */
  bbox?: [number, number, number, number];
  limit?: number;
}

const strip = (doc: any): iAlertModel => {
  const { __v, ...rest } = doc;
  return rest as iAlertModel;
};

/**
 * Alerts persistence (spec §5/§7). Dedup is the `(source, identifier)` upsert;
 * supersede/expire flip `active` without deleting (history is the point of the
 * DB). `list` backs both the admin page and the map's bbox-scoped load.
 */
export function makeAlertsRepo(model: Model<iAlertModel>) {
  return {
    model,

    /** Insert-or-update by the dedup key. Returns true if a new doc was inserted. */
    async upsert(alert: iAlert): Promise<{ inserted: boolean }> {
      const { id: _id, ...rest } = alert as iAlert & { id?: string };
      const res = await model
        .updateOne(
          { source: alert.source, identifier: alert.identifier },
          { $set: rest, $setOnInsert: { id: uuidv4() } },
          { upsert: true },
        )
        .exec();
      return { inserted: (res.upsertedCount ?? 0) > 0 };
    },

    /** Mark referenced messages of a source inactive (supersede / cancel chain). */
    async supersede(source: string, identifiers: string[]): Promise<number> {
      if (!identifiers.length) return 0;
      const res = await model
        .updateMany(
          { source, identifier: { $in: identifiers }, active: true },
          { $set: { active: false } },
        )
        .exec();
      return res.modifiedCount ?? 0;
    },

    /** Flip expired-but-still-active alerts inactive. `nowIso` must be UTC ("…Z"). */
    async expire(source: string, nowIso: string): Promise<number> {
      const res = await model
        .updateMany(
          { source, active: true, expiresAt: { $ne: null, $lt: nowIso } },
          { $set: { active: false } },
        )
        .exec();
      return res.modifiedCount ?? 0;
    },

    async list(opts: AlertListOpts = {}): Promise<iAlertModel[]> {
      const q: Record<string, unknown> = {};
      if (opts.activeOnly) q.active = true;
      if (opts.source) q.source = opts.source;
      if (typeof opts.severityMin === "number") q.maxSeverityRank = { $gte: opts.severityMin };
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        q["info.area.geometry"] = {
          $geoIntersects: {
            $geometry: {
              type: "Polygon",
              coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
            },
          },
        };
      }
      const docs = await model
        .find(q)
        .sort({ maxSeverityRank: -1, sent: -1 })
        .limit(opts.limit ?? 500)
        .lean()
        .exec();
      return docs.map(strip);
    },
  };
}

export type AlertsRepo = ReturnType<typeof makeAlertsRepo>;
