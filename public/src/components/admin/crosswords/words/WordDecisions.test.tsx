/**
 * WordDetail decisions — over a faked API: approve/reject the word and tick
 * family friendly, decide on and edit a clue, who and when, the flags as
 * warnings, and a stored suggestion shown as one.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BankWordDetail } from "@photonsurge/shared/crossword-bank";
import WordDetail from "./WordDetail";

const ID = "64b000000000000000000001";
const base = (over: Partial<BankWordDetail> = {}): BankWordDetail => ({
  id: ID,
  word: "excited",
  length: 7,
  clueStatus: "done",
  pos: ["adjective"],
  categories: [],
  flags: { adult: true },
  warnings: ["adult"],
  approval: { status: "approved", by: "op@example.com", at: Date.UTC(2026, 9, 4, 12, 30) },
  familyFriendly: null,
  zipf: 4.5,
  clueCount: 2,
  senses: [],
  definitions: [],
  clues: [
    { id: "c1", text: "Stirred up and eager", approval: { status: "pending" }, familyFriendly: null },
    { id: "c2", text: "Thrilled to bits", approval: { status: "approved", by: "op@example.com", at: Date.UTC(2026, 9, 4, 12, 31) }, familyFriendly: true },
  ],
  raw: {},
  suggestion: { clue: "Eager with anticipation", familyFriendly: true, reason: "plain sense", model: "m", at: 1 },
  ...over,
});

let current: BankWordDetail;
const sent: { url: string; body: unknown }[] = [];

beforeEach(() => {
  current = base();
  sent.length = 0;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
      // A clue edit returns the approved clue to pending, as the repo does.
      if (String(url).includes("/clues/c2")) {
        current = base({ clues: [current.clues[0], { ...current.clues[1], text: "Very thrilled", approval: { status: "pending" }, familyFriendly: null }] });
      }
    }
    return { ok: true, status: 200, json: async () => current } as Response;
  }) as typeof fetch;
});

it("shows the flags as warnings, who decided and when, and the suggestion marked as one", async () => {
  render(<WordDetail id={ID} />);
  expect(await screen.findByText(/flagged this word: adult/)).toBeInTheDocument();
  expect(screen.getAllByText(/op@example.com/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/2026-10-04 12:30 UTC/).length).toBeGreaterThan(0);
  expect(screen.getByText(/SUGGESTION, not approved/)).toBeInTheDocument();
  expect(screen.getByText(/Eager with anticipation/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Suggest" })).toBeDisabled();
});

it("approves, rejects and tags the word through PATCH words/:id", async () => {
  render(<WordDetail id={ID} />);
  await screen.findByText("Approval");
  fireEvent.click(screen.getByRole("button", { name: "Reject word" }));
  await screen.findByRole("button", { name: "Reject word" });
  fireEvent.click(screen.getByLabelText("Family friendly"));
  await screen.findByRole("button", { name: "Reject word" });
  fireEvent.click(screen.getByRole("button", { name: "Mark not family friendly" }));
  await screen.findByRole("button", { name: "Reject word" });
  expect(sent.map((s) => [s.url, s.body])).toEqual([
    [`/api/crossword/words/${ID}`, { approval: "rejected" }],
    [`/api/crossword/words/${ID}`, { familyFriendly: true }],
    [`/api/crossword/words/${ID}`, { familyFriendly: false }],
  ]);
});

it("decides on a clue through PATCH clues/:id", async () => {
  render(<WordDetail id={ID} />);
  const table = await screen.findByRole("table", { name: "Clues" });
  const row = within(table).getByText("Stirred up and eager").closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "Approve" }));
  await screen.findByRole("table", { name: "Clues" });
  fireEvent.click(within(row).getByRole("checkbox"));
  await screen.findByRole("table", { name: "Clues" });
  fireEvent.click(within(row).getByRole("button", { name: "Reject" }));
  await screen.findByRole("table", { name: "Clues" });
  expect(sent.map((s) => [s.url, s.body])).toEqual([
    ["/api/crossword/clues/c1", { approval: "approved" }],
    ["/api/crossword/clues/c1", { familyFriendly: true }],
    ["/api/crossword/clues/c1", { approval: "rejected" }],
  ]);
});

it("shows an edited approved clue back as pending", async () => {
  render(<WordDetail id={ID} />);
  const table = await screen.findByRole("table", { name: "Clues" });
  const row = within(table).getByText("Thrilled to bits").closest("tr")!;
  expect(within(row).getByText("approved")).toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
  const box = within(row).getByLabelText("Clue text");
  fireEvent.change(box, { target: { value: "Very thrilled" } });
  fireEvent.keyDown(box, { key: "Enter" });
  const edited = (await within(table).findByText("Very thrilled")).closest("tr")!;
  expect(sent[0]).toEqual({ url: "/api/crossword/clues/c2", body: { text: "Very thrilled" } });
  expect(within(edited).getByText("pending")).toBeInTheDocument();
  expect(within(edited).queryByText("approved")).toBeNull();
});

it("accepting the suggestion asks for it as a candidate clue and approves nothing", async () => {
  render(<WordDetail id={ID} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add as a candidate clue" }));
  await screen.findByText("Approval");
  expect(sent).toEqual([{ url: `/api/crossword/words/${ID}`, body: { acceptSuggestion: true } }]);
});

it("shows an error when a decision fails", async () => {
  render(<WordDetail id={ID} />);
  await screen.findByText("Approval");
  (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }) as Response);
  fireEvent.click(screen.getByRole("button", { name: "Reject word" }));
  expect(await screen.findByText(/Couldn't save that: boom/)).toBeInTheDocument();
});

it("can't approve a clue that can't air, and says why", async () => {
  current = base({ clues: [{ id: "c9", text: "Ruin", approval: { status: "pending" }, familyFriendly: null }] });
  render(<WordDetail id={ID} />);
  const table = await screen.findByRole("table", { name: "Clues" });
  expect(within(table).getByRole("button", { name: "Approve" })).toBeDisabled();
  expect(within(table).getByText(/too short to air/)).toBeInTheDocument();
});

it("sets not family friendly by hand on the word and on a clue", async () => {
  render(<WordDetail id={ID} />);
  const table = await screen.findByRole("table", { name: "Clues" });
  fireEvent.click(screen.getAllByRole("button", { name: "Not family friendly" })[0]);
  await waitFor(() => expect(sent).toHaveLength(1));
  await waitFor(() => expect(within(table).getAllByRole("button", { name: "Not" })[0]).toBeEnabled());
  fireEvent.click(within(table).getAllByRole("button", { name: "Not" })[0]);
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent.map((s) => s.body)).toEqual([{ familyFriendly: false }, { familyFriendly: false }]);
});
