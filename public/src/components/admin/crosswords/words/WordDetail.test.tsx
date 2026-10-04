/** WordDetail — over a faked /api/crossword/words/:id: senses, clues, verdict and raw JSON. */
import { render, screen, within } from "@testing-library/react";
import type { BankWordDetail } from "@photonsurge/shared/crossword-bank";
import WordDetail from "./WordDetail";

const word: BankWordDetail = {
  id: "64b000000000000000000001",
  word: "wreck",
  length: 5,
  clueStatus: "done",
  pos: ["noun"],
  categories: ["ships"],
  flags: {},
  model: "local-7b",
  decision: "accepted",
  decisionBy: "operator",
  zipf: 4.2,
  clueCount: 2,
  senses: [
    { pos: "noun", definitions: ["The remains of a ruined ship", "Something in very poor condition"] },
    { pos: "verb", definitions: ["To destroy or ruin"] },
  ],
  clues: [
    { id: "c1", text: "Ship's sad remains", difficulty: 3, source: "model", status: "approved", original: "Ship remains (5)" },
    { id: "c2", text: "Ruin", difficulty: 2, source: "wordnet", status: "rejected" },
  ],
  validationSources: { hunspell: true, wordnet: { found: true, senses: 4 } },
  definitions: ["A wrecked ship", "To ruin"],
  raw: { attempts: [{ n: 1, ok: true }], validation: { decision: "accepted", zipf: 4.2 } },
};

beforeEach(() => {
  global.fetch = jest.fn(async (url: RequestInfo | URL) =>
    String(url) === "/api/crossword/words/64b000000000000000000001"
      ? ({ ok: true, status: 200, json: async () => word } as Response)
      : ({ ok: false, status: 404, json: async () => ({ error: "no such word" }) } as Response),
  ) as typeof fetch;
});

it("renders senses, clues and the verdict", async () => {
  render(<WordDetail id="64b000000000000000000001" />);
  expect(await screen.findByText("The remains of a ruined ship")).toBeInTheDocument();
  expect(screen.getByText("To destroy or ruin")).toBeInTheDocument();

  const clues = screen.getByRole("table", { name: "Clues" });
  expect(within(clues).getByText("Ship's sad remains")).toBeInTheDocument();
  expect(within(clues).getByText("was: Ship remains (5)")).toBeInTheDocument();
  expect(within(clues).getByText("wordnet")).toBeInTheDocument();
  expect(within(clues).getByText("approved")).toBeInTheDocument();
  expect(within(clues).getByText("rejected")).toBeInTheDocument();

  expect(screen.getAllByText("accepted (operator)").length).toBeGreaterThan(0);
  expect(screen.getByText("hunspell")).toBeInTheDocument();
  expect(screen.getByText("Clue attempts")).toBeInTheDocument();
  expect(screen.getByText("ships")).toBeInTheDocument();
});

it("shows the error for an unknown word", async () => {
  render(<WordDetail id="nope" />);
  expect(await screen.findByText(/no such word/)).toBeInTheDocument();
});
