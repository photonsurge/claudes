/**
 * PreviewPane — the tokened /watch iframe, Play/Stop enablement, and the
 * seed-and-restart note when the preview scene doesn't exist.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import PreviewPane from "./PreviewPane";
import type { ShortPreviewInfo } from "../../../lib/shorts";

const preview: ShortPreviewInfo = { sceneId: "shorts-preview", exists: true, watchToken: "tok", mode: "off" };
const script = { id: "s1", title: "Japan round-up", clipCount: 2 };

it("embeds the preview scene's tokened watch page", () => {
  render(<PreviewPane preview={preview} script={script} onPlay={jest.fn()} onStop={jest.fn()} />);
  expect(screen.getByTitle("Short preview")).toHaveAttribute("src", "/watch/shorts-preview?token=tok");
});

it("plays the selected script; Stop only while the director plays a script", () => {
  const onPlay = jest.fn();
  const onStop = jest.fn();
  const { rerender } = render(<PreviewPane preview={preview} script={script} onPlay={onPlay} onStop={onStop} />);
  expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(onPlay).toHaveBeenCalled();

  rerender(<PreviewPane preview={{ ...preview, mode: "script", scriptId: "s1" }} script={script} onPlay={onPlay} onStop={onStop} />);
  expect(screen.getByText(/playing a script — this one/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(onStop).toHaveBeenCalled();
});

it("disables Play without a selected script", () => {
  render(<PreviewPane preview={preview} script={null} onPlay={jest.fn()} onStop={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
});

it("explains how to create a missing preview scene instead of an empty frame", () => {
  render(<PreviewPane preview={{ sceneId: "shorts-preview", exists: false, mode: "off" }} script={script} onPlay={jest.fn()} onStop={jest.fn()} />);
  expect(screen.getByText(/yarn seed:short-format/)).toBeInTheDocument();
  expect(screen.getByText(/restart the worker/)).toBeInTheDocument();
  expect(screen.queryByTitle("Short preview")).toBeNull();
  expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
});
