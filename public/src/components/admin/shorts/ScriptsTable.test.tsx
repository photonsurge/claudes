/**
 * ScriptsTable — the row columns (scope, m:ss length, preview state + skips)
 * and the row actions (select, preview, confirm-before-delete).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import ScriptsTable from "./ScriptsTable";
import type { ShortFormatRow, ShortListItem, ShortPreviewInfo } from "../../../lib/shorts";

const preview: ShortPreviewInfo = { sceneId: "shorts", exists: true, mode: "off" };
const formats: ShortFormatRow[] = [
  { id: "shorts", name: "Round-up", preview },
  { id: "short-brief", name: "Brief", preview: { sceneId: "short-brief", exists: true, mode: "script", scriptId: "s2", playNonce: 3 } },
];
const rows: ShortListItem[] = [
  {
    id: "s1",
    formatId: "shorts",
    title: "Japan round-up",
    scope: { type: "country", id: "japan" },
    status: "draft",
    clipCount: 2,
    durationMs: 95_000,
    created: "2026-10-04T10:00:00.000Z",
    previewPlay: { sceneId: "shorts", playNonce: 1, startedAt: 1, endedAt: 2, skipped: [{ id: "b", reason: "gone" }] },
  },
  { id: "s2", formatId: "short-brief", title: "World", scope: { type: "globe" }, status: "draft", clipCount: 1, durationMs: 30_000 },
];

const setup = (over: Partial<React.ComponentProps<typeof ScriptsTable>> = {}) => {
  const props = {
    scripts: rows,
    formats,
    selectedId: null,
    onSelect: jest.fn(),
    onPreview: jest.fn(),
    onDelete: jest.fn(),
    confirmDelete: jest.fn().mockReturnValue(true),
    ...over,
  };
  render(<ScriptsTable {...props} />);
  return props;
};

it("shows each script's scope, length, clips and last preview", () => {
  setup();
  const japan = screen.getByText("Japan round-up").closest("tr")!;
  expect(within(japan).getByText(/Country · .+ Japan/)).toBeInTheDocument();
  expect(within(japan).getByText("1:35")).toBeInTheDocument();
  expect(within(japan).getByText("ended")).toBeInTheDocument();
  expect(within(japan).getByText("1 skipped")).toBeInTheDocument();
  expect(within(japan).getByText("Round-up")).toBeInTheDocument();
  // Each row reads its own format's scene: s2 was just asked to play on "Brief".
  const world = screen.getByText("World").closest("tr")!;
  expect(within(world).getByText("starting…")).toBeInTheDocument();
  expect(within(world).getByText("Brief")).toBeInTheDocument();
  expect(within(world).getByText("Globe")).toBeInTheDocument();
});

it("selects on row click and previews without selecting twice", () => {
  const p = setup();
  fireEvent.click(screen.getByText("World"));
  expect(p.onSelect).toHaveBeenCalledWith("s2");
  const japan = screen.getByText("Japan round-up").closest("tr")!;
  fireEvent.click(within(japan).getByRole("button", { name: "Preview" }));
  expect(p.onPreview).toHaveBeenCalledWith("s1");
  expect(p.onSelect).toHaveBeenCalledTimes(1);
});

it("deletes only after the operator confirms", () => {
  const confirmDelete = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  const p = setup({ confirmDelete });
  const del = within(screen.getByText("World").closest("tr")!).getByRole("button", { name: "Delete" });
  fireEvent.click(del);
  expect(p.onDelete).not.toHaveBeenCalled();
  fireEvent.click(del);
  expect(confirmDelete).toHaveBeenLastCalledWith(expect.stringMatching(/World/));
  expect(p.onDelete).toHaveBeenCalledWith("s2");
});

it("disables Preview when the script's format scene doesn't exist", () => {
  setup({ formats: [{ ...formats[0], preview: { ...preview, exists: false } }, formats[1]] });
  expect(within(screen.getByText("Japan round-up").closest("tr")!).getByRole("button", { name: "Preview" })).toBeDisabled();
  expect(within(screen.getByText("World").closest("tr")!).getByRole("button", { name: "Preview" })).toBeEnabled();
});

it("says so when there are no scripts", () => {
  setup({ scripts: [] });
  expect(screen.getByText(/No scripts yet/)).toBeInTheDocument();
});

it("Render opens the Render form for that script (§6.1)", () => {
  const onRender = jest.fn();
  setup({ onRender });
  const row = screen.getByText("Japan round-up").closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "Render" }));
  expect(onRender).toHaveBeenCalledWith("s1");
});
