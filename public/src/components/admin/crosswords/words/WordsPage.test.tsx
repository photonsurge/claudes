/**
 * WordsPage — over a faked /api/crossword/words: reads its filters from the
 * URL, renders totals and rows linking to each word, writes filter changes
 * back to the URL, and explains the import on an empty bank.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import WordsPage from "./WordsPage";
import type { BankWordsResponse } from "./query";

let response: BankWordsResponse;
const calls: string[] = [];

const body = (over: Partial<BankWordsResponse> = {}): BankWordsResponse => ({
  rows: [
    {
      id: "64b000000000000000000001",
      word: "wreck",
      length: 5,
      clueStatus: "done",
      pos: ["noun", "verb"],
      categories: ["ships", "accidents"],
      flags: {},
      warnings: [],
      approval: { status: "pending" },
      familyFriendly: null,
      model: "local-7b",
      decision: "accepted",
      zipf: 4.2,
      clueCount: 5,
      reason: "ok",
    },
    {
      id: "64b000000000000000000002",
      word: "wage",
      length: 4,
      clueStatus: "failed",
      pos: ["noun"],
      categories: [],
      flags: { vulgar: true },
      warnings: ["vulgar"],
      approval: { status: "pending" },
      familyFriendly: null,
      decision: "review",
      clueCount: 0,
      reason: "bad json",
    },
  ],
  total: 2,
  page: 1,
  pageSize: 50,
  totals: {
    byClueStatus: { done: 38_989, pending: 12_081, failed: 3 },
    byDecision: { accept: 51_070, review: 41_190, none: 77_109 },
    byBand: { common: 9_000, none: 100 },
    total: 1_011_999,
  },
  imported: true,
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  response = body();
  window.history.replaceState(null, "", "/admin/crosswords/words?letter=w&status=done");
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => response } as Response;
  }) as typeof fetch;
});

it("loads with the filters from the URL and renders totals and rows", async () => {
  render(<WordsPage />);
  const link = await screen.findByRole("link", { name: "wreck" });
  expect(link).toHaveAttribute("href", "/admin/crosswords/words/64b000000000000000000001");
  expect(calls[0]).toBe("/api/crossword/words?letter=W&status=done");

  const totals = screen.getByLabelText("Bank totals");
  expect(within(totals).getByText("1,011,999")).toBeInTheDocument();
  expect(within(totals).getByText("38,989")).toBeInTheDocument();
  expect(within(totals).getByText("41,190")).toBeInTheDocument();
  expect(within(totals).getByText("Common (4–5)")).toBeInTheDocument();
  expect(within(totals).getByText("No score")).toBeInTheDocument();

  const table = screen.getByRole("table", { name: "Words" });
  expect(within(table).getByText("wage")).toBeInTheDocument();
  expect(within(table).getByText("noun, verb")).toBeInTheDocument();
  expect(within(table).getByText("vulgar")).toBeInTheDocument();
  expect(within(table).getByText("4.20 · Common")).toBeInTheDocument();
  expect(within(table).getByText("bad json")).toBeInTheDocument();
});

it("writes a filter change to the URL and refetches", async () => {
  render(<WordsPage />);
  await screen.findByRole("link", { name: "wreck" });
  fireEvent.click(within(screen.getByRole("group", { name: "Starts with" })).getByRole("button", { name: "M" }));
  await waitFor(() => expect(calls).toContain("/api/crossword/words?letter=M&status=done"));
  expect(window.location.search).toBe("?letter=M&status=done");

  fireEvent.click(screen.getByLabelText("Accepted only"));
  await waitFor(() => expect(window.location.search).toBe("?letter=M&status=done&accepted=1"));
});

it("explains the import when the bank is empty", async () => {
  response = body({ rows: [], total: 0, imported: false, totals: { byClueStatus: {}, byDecision: {}, byBand: {}, total: 0 } });
  render(<WordsPage />);
  expect(await screen.findByText(/isn.t imported on this box/)).toBeInTheDocument();
  expect(screen.getByText(/mongorestore/)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
