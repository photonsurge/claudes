import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { PresenterSettings, PresenterVoice, SpeechModel, VoiceTest } from "../presenter";

/**
 * The presenter collections (docs/presenter-plan.md §5–§8). Shapes are owned
 * by the sanitisers in presenter.ts; Mixed fields here keep that the one place
 * to update.
 */

// --- Presenter catalog -----------------------------------------------------

export interface iPresenterModel extends iGeneralModel {
  id: string;
  _id: string;
  name: string;
  persona: string;
  voice: PresenterVoice;
  rev: number;
}

const PresenterSchema = new mongoose.Schema<iPresenterModel>(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    persona: { type: String, default: "" },
    voice: { type: mongoose.Schema.Types.Mixed, required: true },
    rev: { type: Number, required: true, default: 0 },
  },
  mongoTimestamps,
);

export const getPresenterModel = (conn: Connection) => getModel<iPresenterModel>(conn, "Presenter", PresenterSchema);

// --- Settings singleton (master switch) -------------------------------------

export const PRESENTER_SETTINGS_ID = "default" as const;

export interface iPresenterSettingsModel extends iGeneralModel {
  id: string;
  _id: string;
  settings: PresenterSettings;
}

const PresenterSettingsSchema = new mongoose.Schema<iPresenterSettingsModel>(
  {
    id: { type: String, required: true, unique: true, default: PRESENTER_SETTINGS_ID },
    settings: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
  },
  mongoTimestamps,
);

export const getPresenterSettingsModel = (conn: Connection) =>
  getModel<iPresenterSettingsModel>(conn, "PresenterSettings", PresenterSettingsSchema);

// --- Voice catalog cache (OpenRouter speech models) -------------------------

export const SPEECH_CATALOG_ID = "openrouter" as const;

export interface iSpeechCatalogModel extends iGeneralModel {
  id: string;
  _id: string;
  models: SpeechModel[];
  fetchedAt: Date;
}

const SpeechCatalogSchema = new mongoose.Schema<iSpeechCatalogModel>(
  {
    id: { type: String, required: true, unique: true, default: SPEECH_CATALOG_ID },
    models: { type: mongoose.Schema.Types.Mixed, required: true, default: [] },
    fetchedAt: { type: Date, required: true },
  },
  mongoTimestamps,
);

export const getSpeechCatalogModel = (conn: Connection) =>
  getModel<iSpeechCatalogModel>(conn, "SpeechCatalog", SpeechCatalogSchema);

// --- Voice tests (one spoken take each; audio in the presenter-audio blob ns) --

export interface iVoiceTestModel extends iGeneralModel, Omit<VoiceTest, "createdAt"> {
  id: string;
  _id: string;
  /** Inline audio when the blob folder is off (see inline-blob.ts). */
  data?: Buffer;
}

const VoiceTestSchema = new mongoose.Schema<iVoiceTestModel>(
  {
    id: { type: String, required: true, unique: true },
    presenterId: { type: String, default: null },
    label: { type: String, default: "" },
    text: { type: String, required: true },
    spoken: { type: String, required: false },
    voice: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ["queued", "speaking", "ready", "error"], required: true },
    error: { type: String, required: false },
    audio: { type: mongoose.Schema.Types.Mixed, required: false },
    sent: { type: mongoose.Schema.Types.Mixed, required: false },
    createdBy: { type: String, default: "" },
    data: { type: Buffer, required: false },
  },
  mongoTimestamps,
);

VoiceTestSchema.index({ created: -1 }, { name: "voice_test_created_ix" });
VoiceTestSchema.index({ presenterId: 1, created: -1 }, { name: "voice_test_presenter_ix" });

export const getVoiceTestModel = (conn: Connection) => getModel<iVoiceTestModel>(conn, "VoiceTest", VoiceTestSchema);
