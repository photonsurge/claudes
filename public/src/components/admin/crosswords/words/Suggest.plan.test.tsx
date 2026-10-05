/**
 * Suggest on the word detail page, from the plan (§8.3 Suggest, §7.4): one
 * model call for this word, operator-triggered only (opening the page asks for
 * nothing); the suggestion shows marked as a suggestion, with its
 * family-friendly suggestion and reason; suggesting decides nothing — the
 * word's approval and tag, and its clues, are unchanged.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BankWordDetail } from "@photonsurge/shared/crossword-bank";
import WordDetail from "./WordDetail";

jest.mock("./api", () => ({ ...jest.requireActual("./api"), SUGGEST_POLL_MS: 5, SUGGEST_POLL_MAX: 40 }));

const ID = "64b0000000000000000000aa";
const detail = (over: Partial<BankWordDetail> = {}): BankWordDetail => ({
  id: ID,
  word: "harbor",
  length: 6,
  pos: ["noun"],
  categories: [],
  flags: {},
  warnings: [],
  approval: { status: "pending" },
  familyFriendly: null,
  clueCount: 1,
  senses: [],
  definitions: ["A sheltered area of water where ships can anchor."],
  clues: [{ id: "c1", text: "Port (6)", approval: { status: "pending" }, familyFriendly: null }],
  raw: {},
  ...over,
});

let current: BankWordDetail;
let calls: { url: string; method: string; body: any }[];
const SUGGESTION = { clue: "Safe haven for ships", familyFriendly: false, reason: "Flagged sense in the definitions", model: "vendor/m", at: 42 };

beforeEach(() => {
  current = detail();
  calls = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u === "/api/crossword/suggest") {
      // The job lands a little later.
      setTimeout(() => (current = detail({ suggestion: SUGGESTION })), 15);
      return { ok: true, status: 202, json: async () => ({ queued: true, count: 1 }) } as Response;
    }
    return { ok: true, status: 200, json: async () => current } as Response;
  }) as typeof fetch;
});

const suggestPosts = () => calls.filter((c) => c.url === "/api/crossword/suggest");

it("opening the page asks for no suggestion: only the operator triggers one", async () => {
  render(<WordDetail id={ID} />);
  expect(await screen.findByRole("button", { name: "Suggest" })).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 50));
  expect(suggestPosts()).toHaveLength(0);
});

it("Suggest queues one call for this word, then shows the suggestion marked as one", async () => {
  render(<WordDetail id={ID} />);
  fireEvent.click(await screen.findByRole("button", { name: "Suggest" }));
  await waitFor(() => expect(suggestPosts()).toHaveLength(1));
  const body = suggestPosts()[0].body;
  const ids = body.wordIds ?? [body.wordId];
  expect(ids).toEqual([ID]);
  expect(suggestPosts()[0].method).toBe("POST");

  const clue = await screen.findByText(/Safe haven for ships/);
  expect(screen.getAllByText(/suggestion/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/not approved/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/Flagged sense in the definitions/)).toBeInTheDocument();
  expect(clue).toBeInTheDocument();
});

it("suggesting decides nothing: no PATCH, the word stays pending and untagged", async () => {
  render(<WordDetail id={ID} />);
  fireEvent.click(await screen.findByRole("button", { name: "Suggest" }));
  await screen.findByText(/Safe haven for ships/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Suggest" })).toBeEnabled());
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  expect(calls.every((c) => c.method === "GET" || c.url === "/api/crossword/suggest")).toBe(true);
  expect(screen.getAllByText("pending").length).toBeGreaterThan(0);
  expect(screen.getAllByText("untagged").length).toBeGreaterThan(0);
});

it("adding the suggestion as a clue only proposes it: the word is not approved", async () => {
  current = detail({ suggestion: SUGGESTION });
  render(<WordDetail id={ID} />);
  await screen.findByText(/Safe haven for ships/);
  const add = screen.queryByRole("button", { name: /candidate clue|add.*clue|save.*clue|use/i });
  expect(add).not.toBeNull();
  fireEvent.click(add!);
  await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
  const patches = calls.filter((c) => c.method === "PATCH");
  for (const p of patches) {
    expect(p.body).not.toHaveProperty("approval");
    expect(p.body).not.toHaveProperty("familyFriendly");
  }
});

it("shows a failure to queue", async () => {
  global.fetch = jest.fn(async (url: RequestInfo | URL) =>
    String(url) === "/api/crossword/suggest"
      ? ({ ok: false, status: 500, json: async () => ({ error: "OPENROUTER_API_KEY is not set" }) } as Response)
      : ({ ok: true, status: 200, json: async () => current } as Response),
  ) as typeof fetch;
  render(<WordDetail id={ID} />);
  fireEvent.click(await screen.findByRole("button", { name: "Suggest" }));
  expect(await screen.findByText(/OPENROUTER_API_KEY is not set/)).toBeInTheDocument();
});
