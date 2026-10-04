import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import GenerateForm from "./GenerateForm";
import type { PuzzleRow } from "./api";

const scenes = async () => [{ id: "xw", name: "Crossword One", surface: "crossword" }] as never;
const rows = (...ids: string[]) => ({ ok: true as const, data: { puzzles: ids.map((id) => ({ id }) as PuzzleRow) } });

it("says it is building, then that the puzzle landed", async () => {
  const list = jest.fn().mockResolvedValueOnce(rows("a")).mockResolvedValueOnce(rows("a")).mockResolvedValue(rows("a", "b"));
  const generate = jest.fn().mockResolvedValue({ ok: true, data: { queued: true } });
  render(<GenerateForm loadScenes={scenes} generate={generate} list={list} pollMs={5} waitMs={200} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  });
  expect(generate).toHaveBeenCalledWith("xw");
  expect(await screen.findByText(/new puzzle is built/)).toBeInTheDocument();
});

it("points at the Jobs page when nothing lands", async () => {
  const list = jest.fn().mockResolvedValue(rows("a"));
  const generate = jest.fn().mockResolvedValue({ ok: true, data: { queued: true } });
  render(<GenerateForm loadScenes={scenes} generate={generate} list={list} pollMs={5} waitMs={30} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  });
  expect(await screen.findByText(/Check the Jobs page/)).toBeInTheDocument();
});
