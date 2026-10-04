/**
 * The Words list's count against docs/crossword-mode-plan.md §8.3 and the
 * batch's intent: a filtered count stops at 10,000 and the page shows it as
 * "10,000+", never as an exact total.
 */
import { render, screen } from "@testing-library/react";
import WordsPage from "./WordsPage";
import type { BankWordsResponse } from "./query";

let response: BankWordsResponse;
const row = (i: number) => ({
  id: `64b0000000000000000001${String(i).padStart(2, "0")}`,
  word: `word${i}`,
  length: 5,
  clueStatus: "done",
  pos: ["noun"],
  categories: [],
  flags: {},
  warnings: [],
  approval: { status: "pending" as const },
  familyFriendly: null,
  decision: "accepted",
  zipf: 4,
  clueCount: 1,
  reason: "",
});
const body = (over: Partial<BankWordsResponse>): BankWordsResponse =>
  ({
    rows: Array.from({ length: 50 }, (_, i) => row(i)),
    total: 10_000,
    totalCapped: true,
    page: 1,
    pageSize: 50,
    totals: { byClueStatus: {}, byDecision: {}, byBand: {}, total: 1_000_000 },
    pool: { words: 0, ffWords: 0, puzzlesWithoutRepeat: 0, ffPuzzlesWithoutRepeat: 0, targetWords: 280 },
    imported: true,
    ...over,
  }) as BankWordsResponse;

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/crosswords/words?letter=s");
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => response }) as Response) as typeof fetch;
});

it("a capped count reads 10,000+", async () => {
  response = body({});
  render(<WordsPage />);
  expect(await screen.findByText(/10,000\+/)).toBeInTheDocument();
});

it("an exact count of 10,000 reads 10,000 with no plus", async () => {
  response = body({ totalCapped: false });
  render(<WordsPage />);
  expect(await screen.findByText(/of 10,000$/)).toBeInTheDocument();
  expect(screen.queryByText(/10,000\+/)).not.toBeInTheDocument();
});

it("a small exact count has no plus", async () => {
  response = body({ rows: [row(1)], total: 1, totalCapped: false });
  render(<WordsPage />);
  await screen.findByText("word1");
  expect(screen.queryByText(/\+/)).not.toBeInTheDocument();
});
