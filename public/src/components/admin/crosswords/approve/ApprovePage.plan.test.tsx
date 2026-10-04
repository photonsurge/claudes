/**
 * The approval queue, from the plan (§7.4, §8.3 Approve): one word at a time
 * in the order the route gives (most common first); it shows the word, its
 * definitions, any flags (as warnings) and its candidate clues after
 * `cleanClue`; it is keyboard-driven (approve the word, select a clue, approve
 * it, tick family friendly on both, next) and can skip, leaving skipped words
 * out of later fetches; filters by frequency band, length, starts-with and
 * only-with-suggestions; a suggestion is shown as one, and accepting it adds a
 * candidate clue and approves nothing; the pool counter is shown.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { cleanClue } from "@photonsurge/shared/crossword";
import type { BankQueueClue, BankQueueWord } from "@photonsurge/shared/crossword-bank";
import ApprovePage from "./ApprovePage";

const pool = { words: 296, ffWords: 171, puzzlesWithoutRepeat: 21, ffPuzzlesWithoutRepeat: 12, targetWords: 280 };

const clue = (id: string, text: string, over: Partial<BankQueueClue> = {}): BankQueueClue => ({
  id,
  text,
  cleaned: cleanClue(text),
  problem: null,
  approval: { status: "pending" },
  familyFriendly: null,
  ...over,
});

const oid = (n: number) => `64b0000000000000000000${String(n).padStart(2, "0")}`;

const qword = (n: number, norm: string, over: Partial<BankQueueWord> = {}): BankQueueWord => ({
  id: oid(n),
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
  zipf: 6 - n / 10,
  senses: [],
  definitions: [`Meaning of ${norm.toLowerCase()}`],
  clues: [clue(`${n}a`, `First clue for ${norm.toLowerCase()} (${norm.length})`), clue(`${n}b`, `Second clue for ${norm.toLowerCase()}`)],
  ...over,
});

let batches: BankQueueWord[][];
let gets: string[];
let patches: { url: string; body: Record<string, unknown> }[];
let patchReply: (url: string, body: Record<string, unknown>) => unknown;

beforeEach(() => {
  batches = [[qword(1, "WATER"), qword(2, "WAGES"), qword(3, "HOUSE")]];
  gets = [];
  patches = [];
  patchReply = () => ({ ok: true });
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      patches.push({ url: u, body });
      return { ok: true, status: 200, json: async () => patchReply(u, body) } as Response;
    }
    gets.push(u);
    return { ok: true, status: 200, json: async () => ({ words: batches.shift() ?? [], pool }) } as Response;
  }) as typeof fetch;
});

const press = async (key: string, init: KeyboardEventInit = {}) => {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? window, { key, ...init });
  });
};
const heading = (norm: string) => screen.findByRole("heading", { name: norm });
const clueItem = (text: string) => screen.getByText(text, { selector: "p" }).closest("li")!;

it("asks only the approve/next route for words, and shows them in the order given", async () => {
  render(<ApprovePage />);
  await heading("WATER");
  expect(gets[0]).toMatch(/^\/api\/crossword\/approve\/next(\?|$)/);
  await press("s");
  await heading("WAGES");
  await press("s");
  await heading("HOUSE");
});

it("shows the word, its definitions, its flags as warnings, and the clues after cleanClue", async () => {
  batches = [[qword(1, "WAGES", { flags: { vulgar: true }, warnings: ["vulgar"], definitions: ["Payment for work done"], clues: [clue("w1", "Work remuneration (5)")] })]];
  render(<ApprovePage />);
  await heading("WAGES");
  expect(screen.getByText("Payment for work done")).toBeInTheDocument();
  expect(screen.getByText(/flagged this word: vulgar/)).toBeInTheDocument();
  const list = screen.getByRole("list", { name: "Candidate clues" });
  const shown = within(list).getByText("Work remuneration", { selector: "p" });
  expect(shown.textContent).toBe("Work remuneration");
  expect(within(list).queryByText("Work remuneration (5)", { selector: "p" })).toBeNull();
  // The flag decides nothing: the word is still untagged.
  expect(screen.getAllByText("untagged").length).toBeGreaterThan(0);
});

it("shows the pool counter", async () => {
  render(<ApprovePage />);
  await heading("WATER");
  const box = screen.getByLabelText("Approved pool");
  expect(within(box).getByText("296")).toBeInTheDocument();
  expect(within(box).getByText("171")).toBeInTheDocument();
  expect(within(box).getByText("21")).toBeInTheDocument();
});

it("approves a word, selects a clue, approves it, ticks family friendly for both, and advances — all from the keyboard", async () => {
  render(<ApprovePage />);
  await heading("WATER");
  await press("a");
  await waitFor(() => expect(patches).toHaveLength(1));
  await press("f");
  await waitFor(() => expect(patches).toHaveLength(2));
  await press("2");
  await press("y");
  await waitFor(() => expect(patches).toHaveLength(3));
  await press("t");
  await waitFor(() => expect(patches).toHaveLength(4));
  expect(patches).toEqual([
    { url: `/api/crossword/words/${oid(1)}`, body: { approval: "approved" } },
    { url: `/api/crossword/words/${oid(1)}`, body: { familyFriendly: true } },
    { url: "/api/crossword/clues/1b", body: { approval: "approved" } },
    { url: "/api/crossword/clues/1b", body: { familyFriendly: true } },
  ]);
  const item = clueItem("Second clue for water");
  expect(within(item).getByText("approved")).toBeInTheDocument();
  expect(within(item).getByText("family friendly")).toBeInTheDocument();
  // The other clue was not touched.
  expect(within(clueItem("First clue for water")).getByText("pending")).toBeInTheDocument();

  await press("Enter");
  await heading("WAGES");
  await press("n");
  await heading("HOUSE");
  expect(patches).toHaveLength(4);
});

it("rejects from the keyboard, and marks not family friendly with Shift", async () => {
  render(<ApprovePage />);
  await heading("WATER");
  await press("r");
  await waitFor(() => expect(patches).toHaveLength(1));
  await press("F", { shiftKey: true });
  await waitFor(() => expect(patches).toHaveLength(2));
  await press("1");
  await press("T", { shiftKey: true });
  await waitFor(() => expect(patches).toHaveLength(3));
  await press("x");
  await waitFor(() => expect(patches).toHaveLength(4));
  expect(patches.map((p) => [p.url, p.body])).toEqual([
    [`/api/crossword/words/${oid(1)}`, { approval: "rejected" }],
    [`/api/crossword/words/${oid(1)}`, { familyFriendly: false }],
    ["/api/crossword/clues/1a", { familyFriendly: false }],
    ["/api/crossword/clues/1a", { approval: "rejected" }],
  ]);
});

it("does nothing to a clue until one is selected", async () => {
  render(<ApprovePage />);
  await heading("WATER");
  await press("y");
  await press("t");
  await press("x");
  expect(patches).toEqual([]);
});

it("skips without deciding, and leaves skipped words out of later fetches", async () => {
  batches.push([qword(4, "QUIET")]);
  render(<ApprovePage />);
  await heading("WATER");
  await press("s");
  await heading("WAGES");
  await press("s");
  await heading("HOUSE");
  await waitFor(() => expect(gets.length).toBeGreaterThan(1));
  const later = new URL(gets[gets.length - 1], "http://x").searchParams.get("exclude") ?? "";
  expect(later.split(",")).toEqual(expect.arrayContaining([oid(1), oid(2)]));
  expect(patches).toEqual([]);
});

it("approving a flagged word sends the approval alone; the flag sets no tag", async () => {
  batches = [[qword(1, "TRASH", { flags: { offensive: true }, warnings: ["offensive"] })]];
  render(<ApprovePage />);
  await heading("TRASH");
  await press("a");
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0].body).toEqual({ approval: "approved" });
});

it("an edit of an approved clue comes back pending", async () => {
  batches = [[qword(1, "WATER", { clues: [clue("e1", "Clear liquid", { approval: { status: "approved", by: "op", at: 1 }, familyFriendly: true })] })]];
  render(<ApprovePage />);
  await heading("WATER");
  expect(within(clueItem("Clear liquid")).getByText("approved")).toBeInTheDocument();
  await press("1");
  await press("e");
  const box = await screen.findByLabelText("Edit clue 1");
  fireEvent.change(box, { target: { value: "It falls as rain" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toEqual({ url: "/api/crossword/clues/e1", body: { text: "It falls as rain" } });
  const edited = (await screen.findByText("It falls as rain", { selector: "p" })).closest("li")!;
  expect(within(edited).getByText("pending")).toBeInTheDocument();
  expect(within(edited).queryByText("approved")).toBeNull();
});

it("shows a suggestion as one, and accepting it only adds a candidate clue", async () => {
  const w = qword(1, "WAGES", { suggestion: { clue: "Pay for work", familyFriendly: true, reason: "everyday sense", model: "m", at: 1 } });
  batches = [[w]];
  patchReply = () => ({ ...w, clues: [...w.clues, { id: "new1", text: "Pay for work", approval: { status: "pending" }, familyFriendly: null }] });
  render(<ApprovePage />);
  await heading("WAGES");
  expect(screen.getByText(/SUGGESTION, not approved/)).toBeInTheDocument();
  expect(screen.getByText(/everyday sense/)).toBeInTheDocument();
  await press("u");
  const added = (await screen.findByText("Pay for work", { selector: "p" })).closest("li")!;
  expect(patches).toEqual([{ url: `/api/crossword/words/${w.id}`, body: { acceptSuggestion: true } }]);
  expect(within(added).getByText("pending")).toBeInTheDocument();
  expect(within(added).getByText("untagged")).toBeInTheDocument();
  // The word itself stays pending and untagged.
  const header = screen.getByRole("button", { name: /Approve word/ }).parentElement!;
  expect(within(header).getByText("pending")).toBeInTheDocument();
});

it("sends the band, length, starts-with and suggestions filters", async () => {
  render(<ApprovePage />);
  await heading("WATER");
  batches.push([qword(5, "WALTZ")], [qword(6, "WALTZ")], [qword(7, "WALTZ")], [qword(8, "WALTZ")], [qword(9, "WALTZ")]);

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Frequency" }));
  fireEvent.click(await screen.findByRole("option", { name: /Everyday/ }));
  await waitFor(() => expect(gets.some((g) => g.includes("band=everyday"))).toBe(true));

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Min length" }));
  fireEvent.click(await screen.findByRole("option", { name: "5" }));
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Max length" }));
  fireEvent.click(await screen.findByRole("option", { name: "7" }));
  fireEvent.change(screen.getByLabelText("Starts with"), { target: { value: "w" } });
  fireEvent.click(screen.getByLabelText("Only with suggestions"));

  await waitFor(() => {
    const last = new URL(gets[gets.length - 1], "http://x").searchParams;
    expect(last.get("band")).toBe("everyday");
    expect(last.get("min")).toBe("5");
    expect(last.get("max")).toBe("7");
    expect(last.get("letter")).toBe("W");
    expect(last.get("suggestions")).toBe("1");
  });
});
