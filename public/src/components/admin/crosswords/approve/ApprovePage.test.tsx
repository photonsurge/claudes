/**
 * ApprovePage — the queue over a faked API: keyboard flow (approve a word,
 * select a clue, approve it, tick family friendly on both, next), skipped
 * words excluded from later fetches, an edited approved clue back as pending,
 * filters in the request, the pool counter and the key map.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BankQueueWord } from "@photonsurge/shared/crossword-bank";
import ApprovePage from "./ApprovePage";

const pool = { words: 12, ffWords: 9, puzzlesWithoutRepeat: 0, ffPuzzlesWithoutRepeat: 0, targetWords: 280 };

const word = (n: number, norm: string, over: Partial<BankQueueWord> = {}): BankQueueWord => ({
  id: `64b00000000000000000000${n}`,
  word: norm.toLowerCase(),
  norm,
  length: norm.length,
  pos: ["noun"],
  categories: [],
  flags: {},
  warnings: [],
  clueCount: 2,
  approval: { status: "pending" },
  familyFriendly: null,
  zipf: 5.1,
  senses: [],
  definitions: [`Definition of ${norm}`],
  clues: [
    { id: `c${n}a`, text: "Ship's sad remains (5)", cleaned: "Ship's sad remains", problem: null, approval: { status: "pending" }, familyFriendly: null },
    { id: `c${n}b`, text: "Ruin", cleaned: "Ruin", problem: "short", approval: { status: "pending" }, familyFriendly: null },
  ],
  ...over,
});

let batches: BankQueueWord[][];
const fetched: string[] = [];
const patches: { url: string; body: unknown }[] = [];

beforeEach(() => {
  batches = [[word(1, "WRECK"), word(2, "WAGES"), word(3, "WIDEN")]];
  fetched.length = 0;
  patches.length = 0;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "PATCH") {
      patches.push({ url: u, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    }
    fetched.push(u);
    const words = batches.shift() ?? [];
    return { ok: true, status: 200, json: async () => ({ words, pool }) } as Response;
  }) as typeof fetch;
});

const key = async (k: string, init: KeyboardEventInit = {}) => {
  await act(async () => {
    fireEvent.keyDown(window, { key: k, ...init });
  });
};

it("drives a word and a clue from the keyboard, then advances", async () => {
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WRECK" });
  expect(fetched[0]).toBe("/api/crossword/approve/next?limit=5");
  expect(screen.getByLabelText("Approved pool")).toHaveTextContent("12");
  expect(screen.getByLabelText("Key map")).toBeInTheDocument();
  expect(screen.getByLabelText("Approval queue")).toHaveFocus();

  await key("a");
  await waitFor(() => expect(patches).toHaveLength(1));
  await key("f");
  await waitFor(() => expect(patches).toHaveLength(2));
  await key("1");
  await key("y");
  await waitFor(() => expect(patches).toHaveLength(3));
  await key("t");
  await waitFor(() => expect(patches).toHaveLength(4));

  const id = "64b000000000000000000001";
  expect(patches).toEqual([
    { url: `/api/crossword/words/${id}`, body: { approval: "approved" } },
    { url: `/api/crossword/words/${id}`, body: { familyFriendly: true } },
    { url: "/api/crossword/clues/c1a", body: { approval: "approved" } },
    { url: "/api/crossword/clues/c1a", body: { familyFriendly: true } },
  ]);
  const clue = screen.getByText("Ship's sad remains").closest("li")!;
  await waitFor(() => expect(within(clue).getByText("family friendly")).toBeInTheDocument());
  expect(within(clue).getByText("approved")).toBeInTheDocument();

  await key("n");
  await screen.findByRole("heading", { name: "WAGES" });
  expect(screen.getByLabelText("Approval queue")).toHaveFocus();
});

it("ignores keys typed in a field and ones with a modifier", async () => {
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WRECK" });
  fireEvent.keyDown(screen.getByLabelText("Starts with"), { key: "a" });
  await key("a", { ctrlKey: true });
  expect(patches).toHaveLength(0);
});

it("skips a word and leaves skipped words out of the next fetch", async () => {
  batches.push([word(4, "WAKEN")]);
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WRECK" });
  await key("s");
  await screen.findByRole("heading", { name: "WAGES" });
  await key("s");
  await screen.findByRole("heading", { name: "WIDEN" });
  expect(fetched.length).toBeGreaterThan(1);
  const exclude = decodeURIComponent(fetched[fetched.length - 1]);
  expect(exclude).toContain("64b000000000000000000001");
  expect(exclude).toContain("64b000000000000000000003");
  expect(screen.getByText(/2 skipped/)).toBeInTheDocument();
});

it("shows an edited approved clue back as pending, tag cleared", async () => {
  batches = [[word(1, "WRECK", { clues: [{ id: "c1a", text: "Ship's sad remains", cleaned: "Ship's sad remains", problem: null, approval: { status: "approved", by: "op", at: 1 }, familyFriendly: true }] })]];
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WRECK" });
  const clue = screen.getByText("Ship's sad remains").closest("li")!;
  expect(within(clue).getByText("approved")).toBeInTheDocument();
  await key("1");
  await key("e");
  const box = await screen.findByLabelText("Edit clue 1");
  expect(box).toHaveFocus();
  fireEvent.change(box, { target: { value: "Remains of a ruined ship" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(patches).toEqual([{ url: "/api/crossword/clues/c1a", body: { text: "Remains of a ruined ship" } }]));
  const edited = (await screen.findByText("Remains of a ruined ship")).closest("li")!;
  expect(within(edited).getByText("pending")).toBeInTheDocument();
  expect(within(edited).getByText("untagged")).toBeInTheDocument();
  expect(screen.getByLabelText("Approval queue")).toHaveFocus();
});

it("sends the filters, and refetches from scratch when they change", async () => {
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WRECK" });
  batches.push([word(6, "WALTZ")], [word(7, "WALTZ")]);
  fireEvent.change(screen.getByLabelText("Starts with"), { target: { value: "w" } });
  fireEvent.click(screen.getByLabelText("Only with suggestions"));
  await screen.findByRole("heading", { name: "WALTZ" });
  expect(fetched).toContain("/api/crossword/approve/next?letter=W&suggestions=1&limit=5");
});

it("shows a suggestion as one, and accepting it adds a pending clue", async () => {
  const w = word(1, "WRECK", { suggestion: { clue: "Ruined vessel", familyFriendly: true, reason: "", model: "m", at: 1 } });
  batches = [[w]];
  (global.fetch as jest.Mock).mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push({ url: String(url), body: JSON.parse(String(init.body)) });
      const detail = { ...w, clues: [...w.clues, { id: "c1new", text: "Ruined vessel", approval: { status: "pending" }, familyFriendly: null }] };
      return { ok: true, status: 200, json: async () => detail } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ words: batches.shift() ?? [], pool }) } as Response;
  });
  render(<ApprovePage />);
  await screen.findByRole("heading", { name: "WRECK" });
  expect(screen.getByText(/SUGGESTION, not approved/)).toBeInTheDocument();
  await key("u");
  await screen.findByText("Ruined vessel", { selector: "p" });
  expect(patches[0].body).toEqual({ acceptSuggestion: true });
  expect(patches).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Already a candidate clue" })).toBeDisabled();
});

it("says so when the queue is empty", async () => {
  batches = [[]];
  render(<ApprovePage />);
  expect(await screen.findByText(/No pending words match/)).toBeInTheDocument();
});
