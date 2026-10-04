/**
 * Plan §3 / §8.1 — /admin/access builds each tokened URL with `outputPath`, so a
 * crossword channel shows `/crossword/<id>?token=…` and a weather one
 * `/watch/<id>?token=…`. Copy and Rotate work for both kinds.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AccessPage from "./page";

jest.mock("../../../lib/scenes", () => ({
  listScenes: jest.fn(),
  rotateSceneToken: jest.fn(),
}));
import { listScenes, rotateSceneToken } from "../../../lib/scenes";

const origin = () => window.location.origin;

beforeEach(() => {
  jest.clearAllMocks();
  (listScenes as jest.Mock).mockResolvedValue([
    { id: "default", name: "Main", watchToken: "t-main" },
    { id: "puzzle-hour", name: "Puzzle Hour", surface: "crossword", watchToken: "t-xw" },
  ]);
  (rotateSceneToken as jest.Mock).mockResolvedValue({});
  Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => {}) } });
  jest.spyOn(window, "confirm").mockReturnValue(true);
});

const rowOf = async (name: string) =>
  (await screen.findByText(name, { selector: "p" })).closest(".MuiPaper-root") as HTMLElement;

it("shows /crossword/<id>?token=… for a crossword channel and /watch/<id>?token=… for weather", async () => {
  render(<AccessPage />);
  expect(within(await rowOf("Puzzle Hour")).getByText(`${origin()}/crossword/puzzle-hour?token=t-xw`)).toBeInTheDocument();
  expect(within(await rowOf("Main")).getByText(`${origin()}/watch/default?token=t-main`)).toBeInTheDocument();
  expect(screen.queryByText(/\/watch\/puzzle-hour/)).not.toBeInTheDocument();
});

it("copies the crossword channel's tokened /crossword URL", async () => {
  render(<AccessPage />);
  fireEvent.click(within(await rowOf("Puzzle Hour")).getByRole("button", { name: "Copy" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${origin()}/crossword/puzzle-hour?token=t-xw`);
});

it("rotates a crossword channel's token like a weather one's", async () => {
  render(<AccessPage />);
  fireEvent.click(within(await rowOf("Puzzle Hour")).getByRole("button", { name: /Rotate/ }));
  await waitFor(() => expect(rotateSceneToken).toHaveBeenCalledWith("puzzle-hour"));
});
