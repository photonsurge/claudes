/** Suggest buttons: the word detail's (one word) and the queue's "Suggest for the next N". Never an approval. */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BankWordDetail } from "@photonsurge/shared/crossword-bank";
import WordDetail from "./WordDetail";

jest.mock("./api", () => ({
  ...jest.requireActual("./api"),
  SUGGEST_POLL_MS: 5,
  SUGGEST_POLL_MAX: 20,
}));

const ID = "64b000000000000000000001";
const word = (suggestion?: BankWordDetail["suggestion"]): BankWordDetail => ({
  id: ID,
  word: "excited",
  length: 7,
  pos: [],
  categories: [],
  flags: {},
  warnings: [],
  approval: { status: "pending" },
  familyFriendly: null,
  clueCount: 0,
  senses: [],
  definitions: [],
  clues: [],
  raw: {},
  ...(suggestion ? { suggestion } : {}),
});

it("queues one word, shows it waiting, then shows the suggestion when it lands", async () => {
  let current = word();
  const posts: unknown[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/api/crossword/suggest") {
      posts.push(JSON.parse(String(init?.body)));
      // The job "finishes" after the post.
      current = word({ clue: "Eager with anticipation", familyFriendly: true, reason: "plain", model: "m", at: 5 });
      return { ok: true, status: 202, json: async () => ({ queued: true, count: 1 }) } as Response;
    }
    return { ok: true, status: 200, json: async () => current } as Response;
  }) as typeof fetch;

  render(<WordDetail id={ID} />);
  fireEvent.click(await screen.findByRole("button", { name: "Suggest" }));
  expect(posts).toEqual([{ wordIds: [ID] }]);
  expect(await screen.findByText(/Eager with anticipation/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Suggest" })).toBeEnabled());
  // Nothing was approved by suggesting.
  expect((global.fetch as jest.Mock).mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
});

it("shows a failed queueing", async () => {
  global.fetch = jest.fn(async (url: RequestInfo | URL) =>
    String(url) === "/api/crossword/suggest"
      ? ({ ok: false, status: 401, json: async () => ({ error: "admin only" }) } as Response)
      : ({ ok: true, status: 200, json: async () => word() } as Response),
  ) as typeof fetch;
  render(<WordDetail id={ID} />);
  fireEvent.click(await screen.findByRole("button", { name: "Suggest" }));
  expect(await screen.findByText(/admin only/)).toBeInTheDocument();
});
