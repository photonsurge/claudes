/**
 * LLM translation enrichment for active alerts. Alerts are ephemeral CAP
 * messages, not stable named entities, so the Wikipedia/Wikidata enrich
 * pattern (cities/volcanoes) doesn't apply — this instead reuses the
 * OpenRouter wrapper (../lib/openrouter) also used by the round-up narrator
 * and volcano bulletin parser. Every source's own `sent` timestamp advances
 * on content changes, but adapters don't consistently guarantee that, so
 * candidacy is decided by comparing a content hash against the last
 * translation's stored hash — cheap, source-agnostic, and self-correcting.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { iAlertModel } from "@photonsurge/shared/db/alert-model";
import { alertContentHash } from "@photonsurge/shared/alerts/content-hash";
import { log } from "@photonsurge/shared/utill/logger";
import { ALERTS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { callOpenRouter } from "../lib/openrouter";

const TAG = "job:alerts:translate";
const GAP_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SYSTEM =
  "You are a precise weather-alert translator. Translate CAP (Common Alerting Protocol) " +
  "bulletin text to English, preserving all facts, place names, and numbers exactly. " +
  "Never invent or omit information.";

function buildPrompt(headline: string, description: string, instruction: string): string {
  return [
    "Detect the source language and translate the following weather alert bulletin fields to",
    "English. Respond with ONLY a JSON object of the shape:",
    '{"language": "<ISO 639-1 code of the SOURCE text, e.g. "zh", "en">", "headline": "<English>",',
    '"description": "<English>", "instruction": "<English, or "" if the source instruction is empty>"}',
    "No prose, no markdown fences. If the source text is already English, set language to \"en\"",
    "and return the fields unchanged.",
    "",
    `Headline: ${headline}`,
    `Description: ${description}`,
    `Instruction: ${instruction}`,
  ].join("\n");
}

export interface AlertsTranslateOpts {
  /** Re-translate even entries whose content hash already matches the last translation. */
  force?: boolean;
}

interface TranslateOutcome {
  candidates: number;
  translated: number;
  englishSource: number;
  failed: number;
  skipped: boolean;
}

/**
 * Translate active alerts' non-English headline/description/instruction to
 * English, caching the result per `info[]` entry keyed on a content hash so
 * an unchanged re-ingested alert isn't re-sent to the LLM every poll. Scoped
 * to Severe/Extreme alerts only (ALERTS_TRANSLATE_SEVERITY_MIN, default 3) —
 * the long tail of Minor/Moderate alerts isn't worth the spend yet. Fully
 * skips (never touches Mongo) when `OPENROUTER_API_KEY` is unset.
 */
export async function runAlertsTranslate(opts: AlertsTranslateOpts = {}): Promise<TranslateOutcome> {
  const force = Boolean(opts.force);
  if (!process.env.OPENROUTER_API_KEY) {
    log(TAG, `skipped — no OPENROUTER_API_KEY configured`);
    return { candidates: 0, translated: 0, englishSource: 0, failed: 0, skipped: true };
  }

  // Top 2 severity tiers only for now (Severe/Extreme, rank ≥3 of 0–4) — the
  // long tail of Minor/Moderate alerts isn't worth the LLM spend yet.
  const severityMin = Number(process.env.ALERTS_TRANSLATE_SEVERITY_MIN ?? 3);
  const db = await getAppDb();
  const alerts: iAlertModel[] = await db.alerts.list({ activeOnly: true, severityMin });
  const model = process.env.OPENROUTER_ALERTS_MODEL || process.env.OPENROUTER_MODEL || "google/gemini-3.1-flash-lite";

  let candidates = 0;
  let translated = 0;
  let englishSource = 0;
  let failed = 0;

  for (const alert of alerts) {
    for (let idx = 0; idx < alert.info.length; idx++) {
      const info = alert.info[idx];
      const headline = info.headline ?? "";
      const description = info.description ?? "";
      const instruction = info.instruction ?? "";
      if (!headline.trim() && !description.trim() && !instruction.trim()) continue;

      const hash = alertContentHash(headline, description, instruction);
      if (!force && info.translationHash === hash) continue;
      candidates++;

      const res = await callOpenRouter({
        model,
        system: SYSTEM,
        user: buildPrompt(headline, description, instruction),
        temperature: 0,
        maxTokens: 800,
      });
      if (res.status === "error") {
        failed++;
        log(TAG, `${alert.identifier} info[${idx}] failed`, res.error);
        await sleep(GAP_MS);
        continue;
      }

      const match = res.content.match(/\{[\s\S]*\}/);
      if (!match) {
        failed++;
        log(TAG, `${alert.identifier} info[${idx}] failed`, "no JSON in completion");
        await sleep(GAP_MS);
        continue;
      }

      try {
        const parsed = JSON.parse(match[0]);
        const language = String(parsed?.language || "en").toLowerCase();
        const isEnglish = language === "en";
        await db.alerts.updateTranslation(alert.id, idx, {
          detectedLanguage: language,
          translatedHeadline: isEnglish ? "" : String(parsed?.headline ?? ""),
          translatedDescription: isEnglish ? "" : String(parsed?.description ?? ""),
          translatedInstruction: isEnglish ? "" : String(parsed?.instruction ?? ""),
          translatedAt: new Date().toISOString(),
          translationHash: hash,
        });
        if (isEnglish) englishSource++;
        else translated++;
      } catch (err) {
        failed++;
        log(TAG, `${alert.identifier} info[${idx}] failed`, summarizeForLog(err));
      }
      await sleep(GAP_MS);
    }
  }

  const result = { candidates, translated, englishSource, failed, skipped: false };
  log(TAG, `done`, result);
  blogInfo(
    TAG,
    `alerts translate: ${translated} translated, ${englishSource} already English, ${failed} failed`,
    result,
    "alerts",
    "translate",
  );
  if (translated > 0) emitWorkerEvent({ type: ALERTS_UPDATED, data: { sources: 0, changed: translated } });
  return result;
}

/** Job handler: `alerts.translate`. */
export async function translate(job: Job) {
  const d = job.data?.data ?? {};
  try {
    return await runAlertsTranslate({ force: d.force });
  } catch (err) {
    log(TAG, `translate failed`, summarizeForLog(err));
    blogErr(TAG, `alerts translate failed`, err, "alerts", "translate");
    throw err;
  }
}
