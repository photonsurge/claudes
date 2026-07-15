import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { GvpEruption } from "../volcanoes/gvp-wfs";
import type { iVolcanoEruptionModel } from "./volcano-eruption-model";

/** Domain shape for one eruption (epoch-free — GVP dates are fuzzy year/month/day). */
export interface VolcanoEruption {
  volcanoId: string;
  eruptionNumber: number;
  volcanoName?: string;
  activityType?: string;
  confirmed: boolean;
  vei?: number;
  veiModifier?: string;
  startYear: number;
  startMonth?: number;
  startDay?: number;
  startPrecision: "year" | "month" | "day";
  startModifier?: string;
  startUncertaintyYears?: number;
  startEvidence?: string;
  endYear?: number;
  endMonth?: number;
  endDay?: number;
  endPrecision?: "year" | "month" | "day";
  endModifier?: string;
  endUncertaintyYears?: number;
}

const strip = (doc: any): VolcanoEruption => ({
  volcanoId: doc.volcanoId,
  eruptionNumber: doc.eruptionNumber,
  volcanoName: doc.volcanoName || undefined,
  activityType: doc.activityType || undefined,
  confirmed: Boolean(doc.confirmed),
  vei: doc.vei ?? undefined,
  veiModifier: doc.veiModifier || undefined,
  startYear: doc.startYear,
  startMonth: doc.startMonth ?? undefined,
  startDay: doc.startDay ?? undefined,
  startPrecision: doc.startPrecision,
  startModifier: doc.startModifier || undefined,
  startUncertaintyYears: doc.startUncertaintyYears ?? undefined,
  startEvidence: doc.startEvidence || undefined,
  endYear: doc.endYear ?? undefined,
  endMonth: doc.endMonth ?? undefined,
  endDay: doc.endDay ?? undefined,
  endPrecision: doc.endPrecision || undefined,
  endModifier: doc.endModifier || undefined,
  endUncertaintyYears: doc.endUncertaintyYears ?? undefined,
});

/** Flatten the adapter's fuzzy-date shape into the stored columns. */
export function eruptionToDoc(e: GvpEruption) {
  return {
    volcanoId: e.volcanoId,
    eruptionNumber: e.eruptionNumber,
    volcanoName: e.volcanoName,
    activityType: e.activityType,
    confirmed: e.confirmed,
    vei: e.vei,
    veiModifier: e.veiModifier,
    startYear: e.start.year,
    startMonth: e.start.month,
    startDay: e.start.day,
    startPrecision: e.start.precision,
    startModifier: e.start.modifier,
    startUncertaintyYears: e.start.uncertaintyYears,
    startEvidence: e.startEvidence,
    endYear: e.end?.year,
    endMonth: e.end?.month,
    endDay: e.end?.day,
    endPrecision: e.end?.precision,
    endModifier: e.end?.modifier,
    endUncertaintyYears: e.end?.uncertaintyYears,
  };
}

/**
 * Eruption-history persistence. Permanent + idempotent: upsert on GVP's stable
 * `eruptionNumber`, so re-seeding the whole ~11k catalog never duplicates. Reads
 * are newest-eruption-first and uncapped (the whole point is the full history).
 */
export function makeVolcanoEruptionRepo(model: Model<iVolcanoEruptionModel>) {
  return {
    model,

    async upsertMany(eruptions: GvpEruption[]): Promise<{ upserted: number; matched: number }> {
      if (!eruptions.length) return { upserted: 0, matched: 0 };
      const now = new Date();
      const ops = eruptions.map((e) => ({
        updateOne: {
          filter: { eruptionNumber: e.eruptionNumber },
          update: { $set: { ...eruptionToDoc(e), fetchedAt: now }, $setOnInsert: { id: uuidv4() } },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops, { ordered: false });
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Full eruption history for one volcano, most recent first. No cap. */
    async listForVolcano(volcanoId: string): Promise<VolcanoEruption[]> {
      const docs = await model
        .find({ volcanoId })
        .sort({ startYear: -1, startMonth: -1, startDay: -1 })
        .hint("volcano_eruption_volcano_ix")
        .lean()
        .exec();
      return docs.map(strip);
    },

    /** History for several volcanoes at once (focus/admin composition). */
    async listForVolcanoes(volcanoIds: string[]): Promise<VolcanoEruption[]> {
      if (!volcanoIds.length) return [];
      const docs = await model
        .find({ volcanoId: { $in: volcanoIds } })
        .sort({ startYear: -1 })
        .lean()
        .exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type VolcanoEruptionRepo = ReturnType<typeof makeVolcanoEruptionRepo>;
