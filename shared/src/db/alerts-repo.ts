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
  /**
   * Project the geometry COORDINATES out of the result (keeps `geometry.type`).
   * For consumers that need only properties + a bbox match — panels, counts,
   * target lookup. A whole-planet WMO/marine alert `$geoIntersects` every bbox,
   * so its millions of vertices would otherwise be parsed into the app heap on
   * every located cut (a hard OOM) just to be discarded. The 2dsphere index does
   * the intersect server-side; the coordinates never need to leave Mongo.
   */
  omitCoordinates?: boolean;
  /**
   * Drop the heavy fields no map/broadcast consumer reads: the raw untranslated
   * `info.description` paragraph (feature popups carry `translatedDescription`)
   * and the per-area `geocodes` arrays (a single MeteoAlarm heat alert repeats
   * ~30 NUTS3 codes per language). On the whole-planet `?active=1&limit=5000`
   * feed these dominate the payload; stripping them shrinks it ~10× so every
   * poll re-parses far less (a contributor to the public heap blow-up). Geometry
   * is KEPT (the overlay draws it) — pair with route-side simplification.
   */
  lean?: boolean;
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
     * Retro-fit a resolved boundary onto alerts already stored for that EMMA area.
     *
     * Needed because enrichment happens at INGEST, but `upsert` deliberately skips
     * an unchanged, still-active alert — so an alert stored before its EMMA_ID was
     * resolved would stay shapeless for its whole life, no matter how full the
     * boundary cache got. The caches fill asynchronously, so without this they'd
     * only ever help FUTURE alerts.
     *
     * Only ever fills an EMPTY area (`geometry: null` in the arrayFilter): a
     * source that shipped its own polygon keeps it.
     */
    /**
     * Delete `geometry: null` from every area of every active alert.
     *
     * Mongo's 2dsphere index is sparse per DOC, not per array element: while ALL of
     * an alert's areas are null it has no geo keys and is skipped, but the moment
     * ONE area gets a polygon the doc is indexed, every element is read, and a
     * sibling null rejects the whole write ("geo element must be an array or
     * object"). A MISSING field is skipped happily — so the nulls must go before
     * any area can be filled. Partly-resolved alerts are the norm: a Spanish alert
     * carries ~100 areas and the boundary cache fills a few at a time.
     *
     * Rebuilds each area explicitly rather than `$mergeObjects`-ing a `$$REMOVE`
     * over it — inside `$mergeObjects` a `$$REMOVE` field collapses the literal to
     * `{}`, which merges to nothing and silently KEEPS the null.
     */
    async dropNullGeometries(): Promise<number> {
      const r = await model.updateMany({ active: true, "info.area.geometry": null }, [
        {
          $set: {
            info: {
              $map: {
                input: "$info",
                as: "i",
                in: {
                  $mergeObjects: [
                    "$$i",
                    {
                      area: {
                        $map: {
                          input: "$$i.area",
                          as: "a",
                          in: {
                            areaDesc: "$$a.areaDesc",
                            geocodes: "$$a.geocodes",
                            geometry: {
                              $cond: [
                                { $eq: [{ $ifNull: ["$$a.geometry", null] }, null] },
                                "$$REMOVE",
                                "$$a.geometry",
                              ],
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ]);
      return r.modifiedCount ?? 0;
    },

    async backfillAreaGeometry(emmaId: string, geometry: unknown): Promise<number> {
      const match = { $elemMatch: { valueName: "EMMA_ID", value: emmaId } };
      const r = await model.updateMany(
        { active: true, "info.area.geocodes": match },
        { $set: { "info.$[].area.$[a].geometry": geometry } },
        // `"a.geometry": null` matches a MISSING field too, so this fills only the
        // areas that have nothing yet — a source's own polygon is never touched.
        { arrayFilters: [{ "a.geocodes": match, "a.geometry": null }] },
      );
      return r.modifiedCount ?? 0;
    },

    /**
     * Stamp `capId` on stored alerts whose identifier ALREADY is the canonical CAP
     * id (MeteoAlarm, NWS) — no lookup, no fetch, just a field they were never
     * given because they were ingested before `capId` existed (or on a tick where
     * the unchanged-alert fast path skipped the write).
     *
     * Both sides of a duplicate must be stamped before a match can be seen, so
     * without this the WMO side resolves and still pairs with nothing.
     */
    async backfillDirectCapIds(sources: string[]): Promise<number> {
      const r = await model.updateMany(
        { source: { $in: sources }, active: true, capId: { $in: [null, undefined] } },
        // Pipeline update: copy identifier → capId in the server, no round-trip.
        [{ $set: { capId: "$identifier" } }],
      );
      return r.modifiedCount ?? 0;
    },

    /**
     * Retro-fit a resolved canonical CAP id onto the WMO alert for that capurl.
     * Same reason as `backfillAreaGeometry`: the capurl cache fills long after the
     * alert was ingested, and the unchanged-alert fast path means it is never
     * rewritten — so without this, existing WMO alerts never become mergeable.
     */
    async backfillCapIds(rows: { capurl: string; capId: string }[]): Promise<number> {
      if (!rows.length) return 0;
      const r = await model.bulkWrite(
        rows.map(({ capurl, capId }) => ({
          updateOne: {
            // Active only — an expired alert will never go on air, so stamping it
            // is pure write cost.
            filter: { source: "wmo", active: true, identifier: capurl, capId: { $in: [null, undefined] } },
            update: { $set: { capId } },
          },
        })),
        { ordered: false },
      );
      return r.modifiedCount ?? 0;
    },

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
    async upsert(alert: iAlert): Promise<{ inserted: boolean; prev: iAlertModel | null }> {
      const { id: _id, ...rest } = alert as iAlert & { id?: string };

      // Fast path: CAP messages are immutable per (source, identifier) — a real
      // update ships a new identifier or a new `sent`. So an already-stored alert
      // with the same `sent` that is still active is identical to what we'd write;
      // skip the (heavy — the geometry can be 100s of KB and re-indexing it on the
      // 2dsphere is the dominant cost) write entirely. Lifecycle changes are owned
      // by the expire()/deactivateMissing() sweeps, not this upsert. On a full-feed
      // re-poll this is the 99% case (thousands unchanged, a handful new) — the
      // difference between a seconds-long and a minutes-long ingest. The projection
      // is covered by alert_ver_ix, so the check never reads the geometry.
      const head = await model
        .findOne({ source: alert.source, identifier: alert.identifier }, { sent: 1, active: 1, _id: 0 })
        .lean()
        .exec();
      if (head && head.sent === alert.sent && head.active) {
        return { inserted: false, prev: null };
      }

      // Writing (new / changed / reactivating a deactivated one): carry forward the
      // translate job's cached fields so a re-ingest doesn't wipe them ($set
      // replaces the info[] array wholesale). Only fetched on the write path. Read
      // everything but `raw` so it can double as the `prev` the ingest loop diffs
      // for revision capture (a real update always lands here, never the fast path).
      const existing = head
        ? await model
            .findOne({ source: alert.source, identifier: alert.identifier }, { raw: 0 })
            .lean()
            .exec()
        : null;
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
      return { inserted: (res.upsertedCount ?? 0) > 0, prev: existing ? strip(existing) : null };
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

    /** One alert by id, full doc (including `raw` — the detail page shows it). */
    async getById(id: string): Promise<iAlertModel | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? strip(doc) : null;
    },

    /**
     * The CAP lifecycle chain around one message: same-source docs it
     * references (the messages it updates/cancels) plus docs that reference
     * IT (later updates), plus the focal message itself. CAP references are
     * "sender,identifier,sent" strings, so both directions match on the
     * identifier substring. Sorted oldest-first by `sent` — a ready-made
     * timeline. `raw` is dropped (chain rows are summary rows).
     */
    async chain(
      source: string,
      identifier: string,
      opts: { omitCoordinates?: boolean } = {},
    ): Promise<iAlertModel[]> {
      // Chain rows are summary rows (`raw` dropped). Callers that only need the
      // lifecycle metadata — the focus bundle's buildTimeline reads id/sent/
      // msgType/severity, never the polygon — pass omitCoordinates to keep the
      // (potentially huge, per-message-duplicated) geometry out of the heap.
      const projection: Record<string, 0> = { raw: 0 };
      if (opts.omitCoordinates) projection["info.area.geometry.coordinates"] = 0;
      const focal = await model.findOne({ source, identifier }).select(projection).lean().exec();
      if (!focal) return [];
      // Identifiers this message points back at (middle CSV field of each ref).
      const backIds = (focal.references ?? [])
        .map((ref) => ref.split(",")[1] ?? ref)
        .filter(Boolean);
      const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const docs = await model
        .find({
          source,
          $or: [
            { identifier: { $in: [identifier, ...backIds] } },
            { references: { $regex: escaped } },
          ],
        })
        .select(projection)
        .sort({ sent: 1 })
        .lean()
        .exec();
      return docs.map(strip);
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
      // `raw` is the original feed payload kept for debugging/re-parsing; it can
      // dwarf the parsed doc and no list() consumer reads it. `omitCoordinates`
      // additionally drops the (potentially enormous) polygon vertices.
      const projection: Record<string, 0> = { raw: 0 };
      if (opts.omitCoordinates) projection["info.area.geometry.coordinates"] = 0;
      if (opts.lean) {
        // Unread on the map/world-watch feed — see AlertListOpts.lean. Pure
        // exclusions, so they compose with the ones above.
        projection["info.description"] = 0;
        projection["info.area.geocodes"] = 0;
      }
      let query = model
        .find(q)
        .select(projection)
        .sort({ maxSeverityRank: -1, sent: -1 })
        .limit(opts.limit ?? 0); // 0 = no cap; return all matching alerts
      if (opts.bbox) {
        // Force the geo index so the planner skips its multi-plan trial run — a
        // $geoIntersects trial costs 100ms+ *per call* (all planningTimeMicros;
        // the scan itself returns a handful of docs). active-scoped reads use the
        // partial active+geo index (only valid when the query carries active:true,
        // which `activeOnly` sets); unscoped reads the plain sparse geo index.
        query = query.hint(opts.activeOnly ? "alert_active_geo_ix" : "alert_geo_ix");
      }
      const docs = await query.lean().exec();
      return docs.map(strip);
    },
  };
}

export type AlertsRepo = ReturnType<typeof makeAlertsRepo>;
