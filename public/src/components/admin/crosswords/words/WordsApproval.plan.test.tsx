/**
 * Words admin approval, from the plan (§7.4, §8.3 Words): the detail page
 * approves or rejects the word and ticks family friendly, approves / edits /
 * rejects each clue and tags it, and shows who decided and when; the bank's
 * adult / vulgar / offensive flags are warnings that decide nothing; a stored
 * suggestion is shown as a suggestion and accepting it only adds a candidate
 * clue. The list filters on approval and family friendly and shows the pool
 * counter (approved words, family-friendly words, puzzles without a repeat).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BankPoolCounts, BankWordDetail } from "@photonsurge/shared/crossword-bank";
import WordDetail from "./WordDetail";
import WordsPage from "./WordsPage";
import PoolCounter from "./PoolCounter";
import { bankQueryString, parseBankQuery, type BankWordsResponse } from "./query";

const ID = "64b0000000000000000000ab";
const AT = Date.UTC(2026, 9, 3, 9, 15);

const detail = (over: Partial<BankWordDetail> = {}): BankWordDetail => ({
  id: ID,
  word: "wages",
  length: 5,
  clueStatus: "done",
  pos: ["noun"],
  categories: [],
  flags: { offensive: true },
  warnings: ["offensive"],
  approval: { status: "pending" },
  familyFriendly: null,
  zipf: 4.4,
  clueCount: 2,
  senses: [{ pos: "noun", definitions: ["Payment for work"] }],
  definitions: ["Payment for work"],
  clues: [
    { id: "k1", text: "Work remuneration (5)", approval: { status: "pending" }, familyFriendly: null },
    { id: "k2", text: "Weekly pay", approval: { status: "approved", by: "ed@example.com", at: AT }, familyFriendly: true, familyFriendlyBy: "ed@example.com", familyFriendlyAt: AT },
  ],
  raw: {},
  ...over,
});

let current: BankWordDetail;
let sent: { method: string; url: string; body?: unknown }[];

function serve(onPatch?: (url: string, body: Record<string, unknown>) => void) {
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      sent.push({ method: "PATCH", url: u, body });
      onPatch?.(u, body);
      return { ok: true, status: 200, json: async () => (u.includes("/clues/") ? { ok: true } : current) } as Response;
    }
    sent.push({ method: "GET", url: u });
    return { ok: true, status: 200, json: async () => current } as Response;
  }) as typeof fetch;
}
const patches = () => sent.filter((s) => s.method === "PATCH").map((s) => [s.url, s.body]);

beforeEach(() => {
  current = detail();
  sent = [];
  serve();
});

describe("word detail decisions", () => {
  it("approves, rejects and returns the word to pending through PATCH words/:id", async () => {
    serve((_u, b) => {
      if (b.approval) current = { ...current, approval: { status: b.approval as "approved", by: "op@example.com", at: AT } };
    });
    render(<WordDetail id={ID} />);
    const settled = (n: number, next: string) =>
      waitFor(() => {
        expect(patches()).toHaveLength(n);
        expect(screen.getByRole("button", { name: next })).toBeEnabled();
      });
    fireEvent.click(await screen.findByRole("button", { name: "Approve word" }));
    await settled(1, "Reject word");
    fireEvent.click(screen.getByRole("button", { name: "Reject word" }));
    await settled(2, "Back to pending");
    fireEvent.click(screen.getByRole("button", { name: "Back to pending" }));
    await waitFor(() => expect(patches()).toHaveLength(3));
    expect(patches()).toEqual([
      [`/api/crossword/words/${ID}`, { approval: "approved" }],
      [`/api/crossword/words/${ID}`, { approval: "rejected" }],
      [`/api/crossword/words/${ID}`, { approval: "pending" }],
    ]);
  });

  it("shows who decided and when, on the word and on each clue", async () => {
    current = detail({ approval: { status: "approved", by: "op@example.com", at: AT }, familyFriendly: true, familyFriendlyBy: "ff@example.com", familyFriendlyAt: AT });
    render(<WordDetail id={ID} />);
    await screen.findByRole("button", { name: "Approve word" });
    expect(screen.getAllByText(/op@example\.com/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ff@example\.com/).length).toBeGreaterThan(0);
    const row = within(screen.getByRole("table", { name: "Clues" })).getByText("Weekly pay").closest("tr")!;
    expect(within(row).getByText(/ed@example\.com/)).toBeInTheDocument();
    expect(within(row).getByText(/2026-10-03/)).toBeInTheDocument();
  });

  it("approves, tags, edits and rejects a clue through PATCH clues/:id", async () => {
    render(<WordDetail id={ID} />);
    const table = await screen.findByRole("table", { name: "Clues" });
    const row = () => within(table).getByText(/Work remuneration/).closest("tr")!;
    fireEvent.click(within(row()).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    fireEvent.click(within(row()).getByRole("checkbox"));
    await waitFor(() => expect(patches()).toHaveLength(2));
    const r = row();
    fireEvent.click(within(r).getByRole("button", { name: "Edit" }));
    const box = within(r).getByLabelText("Clue text");
    fireEvent.change(box, { target: { value: "Pay for a week's work" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(patches()).toHaveLength(3));
    fireEvent.click(within(row()).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(patches()).toHaveLength(4));
    expect(patches()).toEqual([
      ["/api/crossword/clues/k1", { approval: "approved" }],
      ["/api/crossword/clues/k1", { familyFriendly: true }],
      ["/api/crossword/clues/k1", { text: "Pay for a week's work" }],
      ["/api/crossword/clues/k1", { approval: "rejected" }],
    ]);
  });

  it("shows an edited approved clue as pending once the server says so", async () => {
    serve((u, b) => {
      if (u.endsWith("/clues/k2") && b.text) {
        current = detail({
          clues: [current.clues[0], { ...current.clues[1], text: String(b.text), original: "Weekly pay", approval: { status: "pending", by: "op@example.com", at: AT }, familyFriendly: null }],
        });
      }
    });
    render(<WordDetail id={ID} />);
    const table = await screen.findByRole("table", { name: "Clues" });
    const row = within(table).getByText("Weekly pay").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const box = within(row).getByLabelText("Clue text");
    fireEvent.change(box, { target: { value: "Pay packet" } });
    fireEvent.keyDown(box, { key: "Enter" });
    const edited = (await within(table).findByText("Pay packet")).closest("tr")!;
    expect(within(edited).getByText("pending")).toBeInTheDocument();
    expect(within(edited).queryByText("approved")).toBeNull();
    // The edit was sent alone: nothing re-approved it.
    expect(patches()).toEqual([["/api/crossword/clues/k2", { text: "Pay packet" }]]);
  });

  it("shows the bank's flags as a warning and decides nothing from them", async () => {
    current = detail({ flags: { adult: true, vulgar: true, offensive: true }, warnings: ["adult", "vulgar", "offensive"] });
    render(<WordDetail id={ID} />);
    expect(await screen.findByText(/adult, vulgar, offensive/)).toBeInTheDocument();
    // Still untagged: the flags pre-set a suggestion only.
    const approval = screen.getByText("Approval").closest("div")!;
    expect(within(approval).getByText("untagged")).toBeInTheDocument();
    expect(screen.getByLabelText("Family friendly")).not.toBeChecked();
    // The operator can still approve a flagged word and tag it family friendly.
    expect(screen.getByRole("button", { name: "Approve word" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Family friendly"));
    await waitFor(() => expect(patches()).toEqual([[`/api/crossword/words/${ID}`, { familyFriendly: true }]]));
  });

  it("shows no warning on an unflagged word", async () => {
    current = detail({ flags: {}, warnings: [] });
    render(<WordDetail id={ID} />);
    await screen.findByRole("button", { name: "Approve word" });
    expect(screen.queryByText(/flagged/)).toBeNull();
  });

  it("shows a suggestion as a suggestion, and accepting it only adds a candidate clue", async () => {
    current = detail({ suggestion: { clue: "Pay for work", familyFriendly: true, reason: "everyday sense", model: "m", at: 1 } });
    render(<WordDetail id={ID} />);
    expect(await screen.findByText(/SUGGESTION, not approved/)).toBeInTheDocument();
    expect(screen.getByText(/Pay for work/)).toBeInTheDocument();
    expect(screen.getByText(/everyday sense/)).toBeInTheDocument();
    // The word is not shown as approved or tagged because of the suggestion.
    const approval = screen.getByText("Approval").closest("div")!;
    expect(within(approval).getByText("pending")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add as a candidate clue" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()).toEqual([[`/api/crossword/words/${ID}`, { acceptSuggestion: true }]]);
  });
});

describe("the pool counter", () => {
  const pool: BankPoolCounts = { words: 312, ffWords: 187, puzzlesWithoutRepeat: 22, ffPuzzlesWithoutRepeat: 13, targetWords: 280 };

  it("shows approved words, family-friendly words and puzzles without a repeat", () => {
    render(<PoolCounter pool={pool} />);
    const box = screen.getByLabelText("Approved pool");
    expect(within(box).getByText("312")).toBeInTheDocument();
    expect(within(box).getByText("187")).toBeInTheDocument();
    expect(within(box).getByText("22")).toBeInTheDocument();
    expect(within(box).getByText(/13 family friendly/)).toBeInTheDocument();
    expect(within(box).getByText(/Approved words/i)).toBeInTheDocument();
    expect(within(box).getByText("Family friendly")).toBeInTheDocument();
    expect(within(box).getByText(/no repeat/i)).toBeInTheDocument();
  });
});

describe("list filters: approval and family friendly", () => {
  const parse = (qs: string) => parseBankQuery(new URLSearchParams(qs));

  it.each(["pending", "approved", "rejected"] as const)("reads approval=%s and writes it back", (a) => {
    expect(parse(`approval=${a}`)).toEqual({ approval: a });
    expect(parse(bankQueryString({ approval: a }))).toEqual({ approval: a });
  });

  it.each(["yes", "no", "untagged"] as const)("reads family friendly %s and writes it back", (f) => {
    const q = parse(bankQueryString({ familyFriendly: f }));
    expect(q).toEqual({ familyFriendly: f });
  });

  const response = (): BankWordsResponse => ({
    rows: [
      { id: "64b0000000000000000000a1", word: "wages", length: 5, pos: [], categories: [], flags: {}, warnings: [], clueCount: 1, approval: { status: "approved", by: "op", at: AT }, familyFriendly: true },
      { id: "64b0000000000000000000a2", word: "trash", length: 5, pos: [], categories: [], flags: { vulgar: true }, warnings: ["vulgar"], clueCount: 1, approval: { status: "rejected", by: "op", at: AT }, familyFriendly: false },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
    totals: { byClueStatus: {}, byDecision: {}, byBand: {}, total: 2 },
    pool: { words: 1, ffWords: 1, puzzlesWithoutRepeat: 0, ffPuzzlesWithoutRepeat: 0, targetWords: 280 },
    imported: true,
  });

  it("the page asks the route with the filters from the URL, and changes them", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => response() } as Response;
    }) as typeof fetch;
    window.history.replaceState(null, "", "/admin/crosswords/words?approval=rejected&ff=no");
    render(<WordsPage />);
    const table = await screen.findByRole("table", { name: "Words" });
    expect(calls[0]).toBe("/api/crossword/words?approval=rejected&ff=no");
    expect(within(table).getByText("rejected")).toBeInTheDocument();
    expect(within(table).getByText("not family friendly")).toBeInTheDocument();
    expect(within(table).getByText("family friendly")).toBeInTheDocument();

    // Change the family-friendly filter to "Untagged" through the select.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Family friendly" }));
    fireEvent.click(await screen.findByRole("option", { name: "Untagged" }));
    await waitFor(() => expect(calls).toContain("/api/crossword/words?approval=rejected&ff=untagged"));

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Approval" }));
    fireEvent.click(await screen.findByRole("option", { name: "approved" }));
    await waitFor(() => expect(calls).toContain("/api/crossword/words?approval=approved&ff=untagged"));
  });
});
