import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import {
  DEFAULT_PRESENTER,
  sanitizePresenter,
  sanitizePresenterSettings,
  type Presenter,
  type PresenterSettings,
  type SpeechModel,
  type VoiceTest,
} from "../presenter";
import {
  PRESENTER_SETTINGS_ID,
  SPEECH_CATALOG_ID,
  type iPresenterModel,
  type iPresenterSettingsModel,
  type iSpeechCatalogModel,
  type iVoiceTestModel,
} from "./presenter-model";
import type { InlineBlobStore } from "./inline-blob";

const toPresenter = (doc: iPresenterModel): Presenter =>
  sanitizePresenter({
    ...doc,
    updatedAt: doc.updated ? new Date(doc.updated).toISOString() : undefined,
  }) as Presenter;

/**
 * Presenter catalog. With nothing stored, the default presenter is returned
 * (not written — a read must never create state), so the page always has one
 * to test; saving it stores it.
 */
export function makePresenterRepo(model: Model<iPresenterModel>) {
  return {
    model,

    async list(): Promise<Presenter[]> {
      const docs = await model.find({}).sort({ name: 1 }).lean<iPresenterModel[]>().exec();
      return docs.length ? docs.map(toPresenter) : [{ ...DEFAULT_PRESENTER }];
    },

    async get(id: string): Promise<Presenter | null> {
      const doc = await model.findOne({ id }).lean<iPresenterModel>().exec();
      if (doc) return toPresenter(doc);
      if (id === DEFAULT_PRESENTER.id && (await model.estimatedDocumentCount()) === 0) return { ...DEFAULT_PRESENTER };
      return null;
    },

    /** Sanitise and upsert; bumps `rev`. null when the input has no usable id or name. */
    async save(input: unknown): Promise<Presenter | null> {
      const p = sanitizePresenter(input);
      if (!p) return null;
      const doc = await model
        .findOneAndUpdate(
          { id: p.id },
          { $set: { name: p.name, persona: p.persona, voice: p.voice }, $inc: { rev: 1 }, $setOnInsert: { id: p.id } },
          { upsert: true, new: true },
        )
        .lean<iPresenterModel>()
        .exec();
      return doc ? toPresenter(doc) : null;
    },

    async delete(id: string): Promise<boolean> {
      const res = await model.deleteOne({ id }).exec();
      return res.deletedCount > 0;
    },
  };
}

/** The master switch singleton. */
export function makePresenterSettingsRepo(model: Model<iPresenterSettingsModel>) {
  return {
    model,
    async get(): Promise<PresenterSettings> {
      const doc = await model.findOne({ id: PRESENTER_SETTINGS_ID }).lean<iPresenterSettingsModel>().exec();
      return sanitizePresenterSettings(doc?.settings);
    },
    async save(input: unknown): Promise<PresenterSettings> {
      const settings = sanitizePresenterSettings({ ...(await this.get()), ...(input as object) });
      await model
        .updateOne(
          { id: PRESENTER_SETTINGS_ID },
          { $set: { settings }, $setOnInsert: { id: PRESENTER_SETTINGS_ID } },
          { upsert: true },
        )
        .exec();
      return settings;
    },
  };
}

/** OpenRouter's speech models, cached so public never calls OpenRouter. */
export function makeSpeechCatalogRepo(model: Model<iSpeechCatalogModel>) {
  return {
    model,
    async get(): Promise<{ models: SpeechModel[]; fetchedAt: string | null }> {
      const doc = await model.findOne({ id: SPEECH_CATALOG_ID }).lean<iSpeechCatalogModel>().exec();
      return { models: doc?.models ?? [], fetchedAt: doc?.fetchedAt ? new Date(doc.fetchedAt).toISOString() : null };
    },
    async save(models: SpeechModel[], fetchedAt = new Date()): Promise<void> {
      await model
        .updateOne(
          { id: SPEECH_CATALOG_ID },
          { $set: { models, fetchedAt }, $setOnInsert: { id: SPEECH_CATALOG_ID } },
          { upsert: true },
        )
        .exec();
    },
  };
}

const toVoiceTest = (doc: iVoiceTestModel): VoiceTest => {
  const { _id, __v, data, created, updated, ...rest } = doc as iVoiceTestModel & { __v?: number };
  return { ...rest, createdAt: new Date(created ?? Date.now()).toISOString() } as VoiceTest;
};

export type VoiceTestCreate = Pick<VoiceTest, "presenterId" | "label" | "text" | "voice" | "createdBy"> &
  Partial<Pick<VoiceTest, "source" | "fresh">>;

export interface VoiceTestStats {
  takes: number;
  ready: number;
  cached: number;
  /** Sum of the estimated cost of takes that made new audio. */
  estSpendUsd: number;
  /** Estimated cost avoided by reusing audio. */
  estSavedUsd: number;
}

/** Spoken takes from the voice bench. Audio bytes go to the `presenter-audio` blob namespace. */
export function makeVoiceTestRepo(model: Model<iVoiceTestModel>, blobs: InlineBlobStore) {
  return {
    model,

    async create(input: VoiceTestCreate): Promise<VoiceTest> {
      const id = uuidv4();
      await model.create({ ...input, id, status: "queued" });
      return (await this.get(id)) as VoiceTest;
    },

    async get(id: string): Promise<VoiceTest | null> {
      const doc = await model.findOne({ id }).select("-data").lean<iVoiceTestModel>().exec();
      return doc ? toVoiceTest(doc) : null;
    },

    async list(opts: { presenterId?: string; limit?: number } = {}): Promise<VoiceTest[]> {
      const q = opts.presenterId ? { presenterId: opts.presenterId } : {};
      const docs = await model
        .find(q)
        .select("-data")
        .sort({ created: -1 })
        .limit(Math.max(1, Math.min(200, opts.limit ?? 30)))
        .lean<iVoiceTestModel[]>()
        .exec();
      return docs.map(toVoiceTest);
    },

    /** A finished take with this request hash and audio, other than `exceptId`. */
    async findCached(cacheKey: string, exceptId: string): Promise<VoiceTest | null> {
      const doc = await model
        .findOne({ cacheKey, status: "ready", id: { $ne: exceptId }, cachedFrom: { $exists: false } })
        .select("-data")
        .sort({ created: -1 })
        .lean<iVoiceTestModel>()
        .exec();
      return doc ? toVoiceTest(doc) : null;
    },

    /** Totals for the page header. */
    async stats(): Promise<VoiceTestStats> {
      const docs = await model
        .find({})
        .select("status cachedFrom audio.estCostUsd cacheKey")
        .lean<Pick<iVoiceTestModel, "status" | "cachedFrom" | "audio" | "cacheKey">[]>()
        .exec();
      const costByKey = new Map<string, number>();
      for (const d of docs) {
        if (d.status === "ready" && !d.cachedFrom && d.cacheKey && d.audio?.estCostUsd != null) costByKey.set(d.cacheKey, d.audio.estCostUsd);
      }
      const out: VoiceTestStats = { takes: docs.length, ready: 0, cached: 0, estSpendUsd: 0, estSavedUsd: 0 };
      for (const d of docs) {
        if (d.status !== "ready") continue;
        out.ready++;
        if (d.cachedFrom) {
          out.cached++;
          out.estSavedUsd += (d.cacheKey && costByKey.get(d.cacheKey)) || 0;
        } else out.estSpendUsd += d.audio?.estCostUsd ?? 0;
      }
      return out;
    },

    async update(id: string, patch: Partial<Omit<VoiceTest, "id" | "createdAt">>): Promise<void> {
      await model.updateOne({ id }, { $set: patch }).exec();
    },

    /** Store the take's audio and mark it ready. */
    async putAudio(id: string, bytes: Buffer, patch: Partial<Omit<VoiceTest, "id" | "createdAt">>): Promise<void> {
      await blobs.put(id, bytes);
      await model.updateOne({ id }, { $set: { ...patch, data: blobs.inlineValue(bytes) } }).exec();
    },

    async getAudio(id: string): Promise<{ data: Buffer; contentType: string } | null> {
      const doc = await model.findOne({ id }).exec();
      if (!doc || !doc.audio) return null;
      const data = await blobs.get(id, doc.data);
      return data && data.length ? { data, contentType: doc.audio.contentType } : null;
    },

    async delete(id: string): Promise<boolean> {
      const res = await model.deleteOne({ id }).exec();
      await blobs.delete([id]);
      return res.deletedCount > 0;
    },

    /** Drop takes older than `before`, with their audio. Returns how many. */
    async pruneOlderThan(before: Date): Promise<number> {
      const old = await model.find({ created: { $lt: before } }).select("id").lean<{ id: string }[]>().exec();
      if (!old.length) return 0;
      const ids = old.map((d) => d.id);
      await model.deleteMany({ id: { $in: ids } }).exec();
      await blobs.delete(ids);
      return ids.length;
    },
  };
}

export type PresenterRepo = ReturnType<typeof makePresenterRepo>;
export type PresenterSettingsRepo = ReturnType<typeof makePresenterSettingsRepo>;
export type SpeechCatalogRepo = ReturnType<typeof makeSpeechCatalogRepo>;
export type VoiceTestRepo = ReturnType<typeof makeVoiceTestRepo>;
