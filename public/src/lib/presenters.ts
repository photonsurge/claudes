/**
 * Client helpers for /admin/presenters (docs/presenter-plan.md, voice audition).
 * Shapes come from the shared presenter module so the page and worker agree.
 */
import type { Presenter, PresenterSettings, PresenterVoice, SpeechModel, VoiceTest } from "@photonsurge/shared/presenter";

export interface SampleText {
  label: string;
  text: string;
}

export interface PresentersResponse {
  presenters: Presenter[];
  settings: PresenterSettings;
  catalog: { models: SpeechModel[]; fetchedAt: string | null };
  samples: SampleText[];
}

async function json<T>(res: Response, what: string): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(body?.error ?? `${what} failed: ${res.status}`);
  return body as T;
}

export async function getPresenters(): Promise<PresentersResponse> {
  return json(await fetch("/api/admin/presenters", { cache: "no-store" }), "presenters fetch");
}

export async function savePresenter(presenter: Partial<Presenter>): Promise<Presenter> {
  const res = await fetch("/api/admin/presenters", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presenter }),
  });
  return (await json<{ presenter: Presenter }>(res, "save")).presenter;
}

export async function deletePresenter(id: string): Promise<void> {
  await json(await fetch(`/api/admin/presenters?id=${encodeURIComponent(id)}`, { method: "DELETE" }), "delete");
}

export async function setPresenterEnabled(enabled: boolean): Promise<PresenterSettings> {
  const res = await fetch("/api/admin/presenters/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return (await json<{ settings: PresenterSettings }>(res, "switch")).settings;
}

export async function refreshVoices(): Promise<{ ok: boolean; error?: string; catalog: PresentersResponse["catalog"] }> {
  return json(await fetch("/api/admin/presenters/voices", { method: "POST" }), "voice refresh");
}

export async function listTakes(limit = 30): Promise<VoiceTest[]> {
  return (await json<{ takes: VoiceTest[] }>(await fetch(`/api/admin/presenters/tests?limit=${limit}`, { cache: "no-store" }), "takes")).takes;
}

export async function getTake(id: string): Promise<VoiceTest | null> {
  const res = await fetch(`/api/admin/presenters/tests?id=${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  return (await json<{ take: VoiceTest }>(res, "take")).take;
}

/** Speak a take. `voice` given = test those (unsaved) settings; omitted = the presenter's saved voice. */
export async function speakTake(input: {
  text: string;
  presenterId?: string | null;
  voice?: PresenterVoice;
  label?: string;
}): Promise<VoiceTest> {
  const res = await fetch("/api/admin/presenters/tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await json<{ take: VoiceTest }>(res, "test")).take;
}

export async function deleteTake(id: string): Promise<void> {
  await json(await fetch(`/api/admin/presenters/tests?id=${encodeURIComponent(id)}`, { method: "DELETE" }), "delete take");
}

export const takeAudioUrl = (id: string) => `/api/admin/presenters/tests/${encodeURIComponent(id)}/audio`;

/** "kokoro-82m · af_heart · 1.1×" */
export function voiceSummary(v: PresenterVoice): string {
  const model = v.model.split("/").pop() ?? v.model;
  return [model, v.voice ?? "default voice", v.speed !== 1 ? `${v.speed}×` : null].filter(Boolean).join(" · ");
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "$0";
  return n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`;
}
