import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iAlert, iAlertModel } from "./alert-model";
import { alertContentHash } from "../alerts/content-hash";

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

    /**
     * Insert-or-update by the dedup key. Returns true if a new doc was inserted.
     *
     * `rest.info` is the WHOLE freshly re-parsed info array from this poll — a
     * Mongo `$set` on an array field replaces it wholesale, not a merge. Left
     * alone, a still-active alert's `info[]` would lose the translate job's
     * cached fields on every re-poll (WMO alone re-polls every 10 minutes),
     * causing it to be re-translated forever. So: read the existing doc first
     * and carry forward each info entry's translation iff its content hash
     * still matches — an unchanged bulletin keeps its cached translation, a
     * changed one is correctly left blank for the next translate tick.
     */
    async upsert(alert: iAlert): Promise<{ inserted: boolean }> {
      const { id: _id, ...rest } = alert as iAlert & { id?: string };

      const existing = await model
        .findOne({ source: alert.source, identifier: alert.identifier }, { info: 1 })
        .lean()
        .exec();
      if (existing?.info?.length) {
        rest.info = rest.info.map((info, i) => {
          const prev = existing.info[i];
          if (!prev?.translationHash) return info;
          const hash = alertContentHash(info.headline ?? "", info.description ?? "", info.instruction ?? "");
          if (hash !== prev.translationHash) return info;
          return {
            ...info,
            detectedLanguage: prev.detectedLanguage,
            translatedHeadline: prev.translatedHeadline,
            translatedDescription: prev.translatedDescription,
            translatedInstruction: prev.translatedInstruction,
            translatedAt: prev.translatedAt,
            translationHash: prev.translationHash,
          };
        });
      }

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

    /**
     * Reconcile: deactivate this source's active alerts whose identifier is NOT
     * in `seenIdentifiers` (the latest full-snapshot batch) — i.e. withdrawn from
     * the feed before expiry. No-op on an empty batch (a dead fetch must not wipe
     * everything). Only call for sources flagged `reconcile`.
     */
    async deactivateMissing(source: string, seenIdentifiers: string[]): Promise<number> {
      if (!seenIdentifiers.length) return 0;
      const res = await model
        .updateMany(
          { source, active: true, identifier: { $nin: seenIdentifiers } },
          { $set: { active: false } },
        )
        .exec();
      return res.modifiedCount ?? 0;
    },

    /**
     * Write back an LLM translation for one `info[]` entry (worker/src/alerts/translate.ts).
     * Callers always pass complete strings — "" for English-source text (no translation
     * needed) rather than omitting the field — so a re-translated-to-English alert
     * properly clears any stale translated text from an earlier non-English version.
     */
    async updateTranslation(
      alertId: string,
      infoIndex: number,
      patch: {
        detectedLanguage: string;
        translatedHeadline: string;
        translatedDescription: string;
        translatedInstruction: string;
        translatedAt: string;
        translationHash: string;
      },
    ): Promise<void> {
      const $set: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        $set[`info.${infoIndex}.${key}`] = value;
      }
      await model.updateOne({ id: alertId }, { $set }).exec();
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
        .limit(opts.limit ?? 0) // 0 = no cap; return all matching alerts
        .lean()
        .exec();
      return docs.map(strip);
    },
  };
}

export type AlertsRepo = ReturnType<typeof makeAlertsRepo>;
