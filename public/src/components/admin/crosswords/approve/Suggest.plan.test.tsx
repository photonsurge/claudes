/**
 * Suggestions in the approval queue, from the plan (§7.4 "Suggestions make it
 * quicker, and are never approvals", §8.3 Approve): the queue shows a
 * suggestion marked as a suggestion, with its family-friendly suggestion and
 * one-line reason; accepting it is one key and still only proposes (a new
 * pending, untagged candidate clue; the word's approval and tag untouched);
 * suggestions are operator-triggered (opening the queue asks for none), and a
 * "suggest" request for the words in view stays within the route's cap.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { cleanClue } from "@photonsurge/shared/crossword";
import type { BankQueueClue, BankQueueWord } from "@photonsurge/shared/crossword-bank";
import ApprovePage from "./ApprovePage";

jest.mock("../words/api", () => ({ ...jest.requireActual("../words/api"), SUGGEST_POLL_MS: 5, SUGGEST_POLL_MAX: 40 }));

const pool = { words: 10, ffWords: 4, puzzlesWithoutRepeat: 0, ffPuzzlesWithoutRepeat: 0, targetWords: 280 };
const oid = (n: number) => `64b00000000000000000${String(n).padStart(4, "0")}`;
const clue = (id: string, text: string): BankQueueClue => ({ id, text, cleaned: cleanClue(text), problem: null, approval: { status: "pending" }, familyFriendly: null });
const qword = (n: number, norm: string, over: Partial<BankQueueWord> = {}): BankQueueWord => ({
  id: oid(n),
  word: norm.toLowerCase(),
  norm,
  length: norm.length,
  pos: ["noun"],
  categories: [],
  flags: {},
  warnings: [],
  clueCount: 1,
  approval: { status: "pending" },
  familyFriendly: null,
  zipf: 5,
  senses: [],
  definitions: [`Meaning of ${norm.toLowerCase()}`],
  clues: [clue(`${n}a`, `Stored clue for ${norm.toLowerCase()}`)],
  ...over,
});

const SUGG = { clue: "Money for a week of work", familyFriendly: false, reason: "Slang sense listed in the definitions", model: "vendor/m", at: 7 };

let batches: BankQueueWord[][];
let calls: { url: string; method: string; body: any }[];
let landed: Record<string, BankQueueWord>;
let patchReply: (url: string, body: any) => unknown;

beforeEach(() => {
  batches = [];
  calls = [];
  landed = {};
  patchReply = () => ({ ok: true });
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });
    if (method === "PATCH") return { ok: true, status: 200, json: async () => patchReply(u, body) } as Response;
    if (u === "/api/crossword/suggest") {
      const ids: string[] = body.wordIds ?? [body.wordId];
      for (const id of ids) landed[id] = { ...(landed[id] ?? ({ id } as BankQueueWord)), suggestion: { ...SUGG, clue: `Suggested ${id.slice(-2)}` } };
      return { ok: true, status: 202, json: async () => ({ queued: true, count: ids.length }) } as Response;
    }
    if (u.startsWith("/api/crossword/words/")) {
      const id = decodeURIComponent(u.split("/").pop()!);
      if (!landed[id]) return { ok: false, status: 404, json: async () => ({ error: "not found" }) } as Response;
      return { ok: true, status: 200, json: async () => landed[id] } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ words: batches.shift() ?? [], pool }) } as Response;
  }) as typeof fetch;
});

const press = async (key: string) => {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? window, { key });
  });
};
const suggestPosts = () => calls.filter((c) => c.url === "/api/crossword/suggest");
const decisionPatches = () => calls.filter((c) => c.method === "PATCH" && ("approval" in (c.body ?? {}) || "familyFriendly" in (c.body ?? {})));

it("shows a stored suggestion marked as a suggestion, with its family-friendly call and reason, deciding nothing", async () => {
  batches = [[qword(1, "WAGES", { suggestion: SUGG })]];
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WAGES" });
  expect(screen.getAllByText(/suggestion/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/not approved/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/Money for a week of work/)).toBeInTheDocument();
  const reason = screen.getByText(/Slang sense listed in the definitions/);
  expect(reason.textContent).toMatch(/not family friendly/i);
  // The model's "not family friendly" is not the word's tag: the word is still untagged and pending.
  const header = screen.getByRole("button", { name: /Approve word/ }).parentElement!;
  expect(within(header).getByText("untagged")).toBeInTheDocument();
  expect(within(header).getByText("pending")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});

it("opening the queue asks for no suggestions: only the operator triggers them", async () => {
  batches = [[qword(1, "WAGES"), qword(2, "WATER")]];
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WAGES" });
  await new Promise((r) => setTimeout(r, 50));
  expect(suggestPosts()).toHaveLength(0);
});

it("accepting is one key, and only proposes: one request, a new pending untagged clue, the word untouched", async () => {
  const w = qword(1, "WAGES", { suggestion: SUGG });
  batches = [[w]];
  patchReply = () => ({ ...w, clues: [...w.clues, { id: "new", text: SUGG.clue, approval: { status: "pending" }, familyFriendly: null }] });
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WAGES" });

  await press("u");
  const added = (await screen.findByText(SUGG.clue, { selector: "p" })).closest("li")!;
  const patches = calls.filter((c) => c.method === "PATCH");
  expect(patches).toHaveLength(1);
  expect(patches[0].url).toBe(`/api/crossword/words/${w.id}`);
  expect(patches[0].body).not.toHaveProperty("approval");
  expect(patches[0].body).not.toHaveProperty("familyFriendly");
  expect(decisionPatches()).toEqual([]);
  expect(within(added).getByText("pending")).toBeInTheDocument();
  expect(within(added).getByText("untagged")).toBeInTheDocument();
  const header = screen.getByRole("button", { name: /Approve word/ }).parentElement!;
  expect(within(header).getByText("pending")).toBeInTheDocument();
  expect(within(header).getByText("untagged")).toBeInTheDocument();
  // Still on the same word: accepting does not decide and move on.
  expect(screen.getByRole("heading", { name: "WAGES" })).toBeInTheDocument();
});

it("the accept key does nothing when there is no suggestion", async () => {
  batches = [[qword(1, "WAGES")]];
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WAGES" });
  await press("u");
  await new Promise((r) => setTimeout(r, 20));
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});

it("suggesting for the words in view queues them, shows the suggestions as they land, and decides nothing", async () => {
  const words = [qword(1, "WAGES"), qword(2, "WATER"), qword(3, "WIDEN", { suggestion: SUGG })];
  batches = [words];
  for (const w of words) landed[w.id] = w;
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WAGES" });
  fireEvent.click(screen.getByRole("button", { name: /^Suggest/ }));
  await waitFor(() => expect(suggestPosts()).toHaveLength(1));
  const ids: string[] = suggestPosts()[0].body.wordIds;
  expect(ids).toContain(words[0].id);
  expect(ids).toContain(words[1].id);
  // A word that already has a suggestion is not asked again.
  expect(ids).not.toContain(words[2].id);
  expect(await screen.findByText(/Suggested 01/)).toBeInTheDocument();
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});

it("never asks for more words than the route's cap in one request", async () => {
  const many = Array.from({ length: 60 }, (_, i) => qword(i + 1, "WORD" + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26))));
  batches = [many];
  for (const w of many) landed[w.id] = w;
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: many[0].norm });
  fireEvent.click(screen.getByRole("button", { name: /^Suggest/ }));
  await waitFor(() => expect(suggestPosts().length).toBeGreaterThan(0));
  for (const p of suggestPosts()) expect((p.body.wordIds ?? [p.body.wordId]).length).toBeLessThanOrEqual(50);
});

it("shows a failure to queue", async () => {
  batches = [[qword(1, "WAGES")]];
  const base = global.fetch as jest.Mock;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    String(url) === "/api/crossword/suggest" ? ({ ok: false, status: 401, json: async () => ({ error: "admin only" }) } as Response) : base(url, init),
  ) as typeof fetch;
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WAGES" });
  fireEvent.click(screen.getByRole("button", { name: /^Suggest/ }));
  expect(await screen.findByText(/admin only/)).toBeInTheDocument();
});
