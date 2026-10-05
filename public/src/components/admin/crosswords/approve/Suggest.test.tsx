/** The queue's "Suggest for the next N": queues the words in view, then shows the suggestions as they land. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BankQueueWord } from "@photonsurge/shared/crossword-bank";
import ApprovePage from "./ApprovePage";

jest.mock("../words/api", () => ({ ...jest.requireActual("../words/api"), SUGGEST_POLL_MS: 5, SUGGEST_POLL_MAX: 20 }));

const pool = { words: 12, ffWords: 9, puzzlesWithoutRepeat: 0, ffPuzzlesWithoutRepeat: 0, targetWords: 280 };
const word = (n: number, norm: string, over: Partial<BankQueueWord> = {}): BankQueueWord => ({
  id: `64b00000000000000000000${n}`,
  word: norm.toLowerCase(),
  norm,
  length: norm.length,
  pos: [],
  categories: [],
  flags: {},
  warnings: [],
  clueCount: 0,
  approval: { status: "pending" },
  familyFriendly: null,
  senses: [],
  definitions: [`Definition of ${norm}`],
  clues: [],
  ...over,
});

it("queues the pending words in view without a suggestion, then shows them when they land", async () => {
  const have = { clue: "Already here", familyFriendly: true, reason: "", model: "m", at: 1 };
  const words = [word(1, "WRECK"), word(2, "WAGES", { suggestion: have }), word(3, "WIDEN")];
  const landed: Record<string, unknown> = {};
  const posts: unknown[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/crossword/suggest") {
      posts.push(JSON.parse(String(init?.body)));
      for (const w of words) landed[w.id] = { ...w, suggestion: { clue: `Clue for ${w.norm}`, familyFriendly: false, reason: "r", model: "m", at: 9 } };
      return { ok: true, status: 202, json: async () => ({ queued: true, count: 2 }) } as Response;
    }
    if (u.startsWith("/api/crossword/words/")) {
      const id = decodeURIComponent(u.split("/").pop()!);
      return { ok: true, status: 200, json: async () => landed[id] ?? words.find((w) => w.id === id) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ words: u.includes("exclude") ? [] : words, pool }) } as Response;
  }) as typeof fetch;

  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WRECK" });
  fireEvent.click(screen.getByRole("button", { name: "Suggest for the next 2" }));
  await waitFor(() => expect(posts).toEqual([{ wordIds: [words[0].id, words[2].id] }]));
  expect(await screen.findByText(/Clue for WRECK/)).toBeInTheDocument();
  // Suggesting never decided anything.
  expect((global.fetch as jest.Mock).mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
});
