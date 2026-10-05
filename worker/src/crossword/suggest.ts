/**
 * Crossword suggestions (docs/crossword-mode-plan.md §7.4) — `crossword.suggest`.
 *
 * For each word the operator picks, one model call (batched) turns the word's
 * definitions and candidate clues into a polished clue for the most common
 * sense and a family-friendly suggestion with a one-line reason. The result is
 * stored on the word as a suggestion (`setWordSuggestion`) and nothing else:
 * approval and tags are the operator's, so a suggestion is never an approval.
 * The definitions are the facts; the model supplies the wording.
 */
import { UnrecoverableError, type Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { cleanClue, validateClue, CLUE_MAX } from "@photonsurge/shared/crossword";
import type { BankWordDetail } from "@photonsurge/shared/crossword-bank";
import { callOpenRouter } from "../lib/openrouter";
import { blogInfo, blogErr, blogWarn } from "../blog";
import { summarizeForLog } from "../utils";

const TAG = "job:crossword";

/** Words per model call. */
export const SUGGEST_BATCH = 10;
/** Most words one request may carry (the route's cap). */
export const SUGGEST_MAX_WORDS = 50;

/** Payload of `crossword.suggest`. */
export interface CrosswordSuggestRequest {
  wordIds: string[];
}

/** The slice of the bank repo this uses. */
export interface SuggestBank {
  getWordById(id: string): Promise<BankWordDetail | null>;
  setWordSuggestion(
    id: string,
    s: { clue: string; familyFriendly: boolean; reason: string; model: string; at: number } | null,
  ): Promise<boolean>;
}

export interface SuggestOutcome {
  requested: number;
  /** Suggestions stored. */
  stored: number;
  /** Of those, stored without a clue because the polished one failed `validateClue`. */
  clueDropped: number;
  /** Ids with no word, nothing to go on, or no usable entry in the reply. */
  skipped: string[];
  /** Ids whose batch failed (model error or unusable reply). */
  failed: string[];
}

/** The model to use, or null when neither variable is set. */
export const suggestModel = (): string | null => process.env.CROSSWORD_MODEL || process.env.OPENROUTER_MODEL || null;

const SYSTEM = [
  "You write crossword clues for a family-friendly YouTube game.",
  "You get a JSON list of answer words, each with dictionary definitions (the facts) and candidate clues.",
  "For each word, using only the facts given, reply with:",
  `- clue: one polished clue of at most ${CLUE_MAX} characters for the word's most common sense. It must not contain the answer or a form of it, and must not state anything the definitions do not support.`,
  "- familyFriendly: true only if the word and the clue are fine for a general audience including children; otherwise false.",
  "- reason: one short line for the familyFriendly call.",
  'Reply with strict JSON only, no prose: {"words":[{"word":"ANSWER","clue":"...","familyFriendly":true,"reason":"..."}]}.',
  "Include every word given, using the answer exactly as given.",
].join("\n");

interface Entry {
  id: string;
  word: string;
  definitions: string[];
  clues: string[];
}

/** What the model is shown for one word, or null when there is nothing to go on. */
export function toEntry(w: BankWordDetail): Entry | null {
  const defs = [...new Set([...(w.definitions ?? []), ...(w.senses ?? []).flatMap((s) => s.definitions ?? [])].map((d) => String(d).trim()).filter(Boolean))].slice(0, 8);
  const clues = [...new Set(w.clues.filter((c) => c.approval.status !== "rejected").map((c) => cleanClue(c.text)).filter(Boolean))].slice(0, 6);
  if (!defs.length && !clues.length) return null;
  return { id: w.id, word: w.word, definitions: defs, clues };
}

interface Reply {
  clue: string;
  familyFriendly: boolean;
  reason: string;
}

const key = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

/** Parse and check a reply: answer → entry. Throws on JSON that is not the asked-for shape. */
export function parseReply(content: string): Map<string, Reply> {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed?.words;
  if (!Array.isArray(list)) throw new Error("reply has no words list");
  const out = new Map<string, Reply>();
  for (const e of list) {
    if (!e || typeof e !== "object" || typeof e.word !== "string" || typeof e.familyFriendly !== "boolean") continue;
    out.set(key(e.word), {
      clue: typeof e.clue === "string" ? cleanClue(e.clue) : "",
      familyFriendly: e.familyFriendly,
      reason: typeof e.reason === "string" ? e.reason.trim() : "",
    });
  }
  if (!out.size) throw new Error("reply has no usable entries");
  return out;
}

/** Suggest for these words. Throws (nothing stored) when the key or the model is not configured. */
export async function suggestWords(bank: SuggestBank, wordIds: string[], fetchImpl?: typeof fetch): Promise<SuggestOutcome> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const model = suggestModel();
  if (!model) throw new Error("CROSSWORD_MODEL (or OPENROUTER_MODEL) is not set");

  const ids = [...new Set(wordIds.filter((x) => typeof x === "string" && x))].slice(0, SUGGEST_MAX_WORDS);
  const out: SuggestOutcome = { requested: ids.length, stored: 0, clueDropped: 0, skipped: [], failed: [] };
  const entries: Entry[] = [];
  for (const id of ids) {
    const w = await bank.getWordById(id);
    const e = w ? toEntry(w) : null;
    if (e) entries.push(e);
    else out.skipped.push(id);
  }

  for (let i = 0; i < entries.length; i += SUGGEST_BATCH) {
    const batch = entries.slice(i, i + SUGGEST_BATCH);
    let replies: Map<string, Reply>;
    try {
      const res = await callOpenRouter({
        model,
        system: SYSTEM,
        user: JSON.stringify({ words: batch.map((e) => ({ word: e.word, definitions: e.definitions, candidateClues: e.clues })) }),
        temperature: 0.3,
        maxTokens: 300 + batch.length * 120,
        responseFormat: "json_object",
        fetchImpl,
      });
      if (res.status !== "ok") throw new Error(res.error ?? "model call failed");
      replies = parseReply(res.content);
    } catch {
      out.failed.push(...batch.map((e) => e.id));
      continue;
    }
    for (const e of batch) {
      const r = replies.get(key(e.word));
      if (!r) {
        out.skipped.push(e.id);
        continue;
      }
      // The polished clue airs only if it would pass the builder's own check.
      const ok = r.clue !== "" && validateClue(r.clue, e.word) === null;
      if (!ok) out.clueDropped++;
      await bank.setWordSuggestion(e.id, { clue: ok ? r.clue : "", familyFriendly: r.familyFriendly, reason: r.reason, model, at: Date.now() });
      out.stored++;
    }
  }
  return out;
}

/** Job handler: `crossword.suggest` — operator-triggered, for the words in `data.wordIds`. */
export async function suggest(job: Job) {
  const req = (job.data?.data ?? {}) as Partial<CrosswordSuggestRequest>;
  const wordIds = Array.isArray(req.wordIds) ? req.wordIds.filter((x): x is string => typeof x === "string") : [];
  try {
    if (!wordIds.length) throw new UnrecoverableError("no wordIds to suggest for");
    const db = await getAppDb();
    const result = await suggestWords(db.crosswordBank, wordIds);
    log(TAG, "suggest done", result);
    const trouble = result.failed.length > 0;
    (trouble ? blogWarn : blogInfo)(TAG, `crossword suggestions: ${result.stored} of ${result.requested} stored${trouble ? `, ${result.failed.length} failed` : ""}`, result, "crossword", "suggest");
    return result;
  } catch (err) {
    log(TAG, "suggest failed", { err: summarizeForLog(err) });
    blogErr(TAG, "crossword suggest failed", err, "crossword", "suggest");
    // A missing key or model is configuration: a retry repeats the answer.
    throw err instanceof UnrecoverableError ? err : new UnrecoverableError((err as Error)?.message ?? String(err));
  }
}
