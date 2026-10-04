/**
 * ScriptsTable — the row columns (scope, m:ss length, preview state + skips)
 * and the row actions (select, preview, confirm-before-delete).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import ScriptsTable from "./ScriptsTable";
import type { ShortListItem, ShortPreviewInfo } from "../../../lib/shorts";

const preview: ShortPreviewInfo = { sceneId: "shorts-preview", exists: true, mode: "off" };
const rows: ShortListItem[] = [
  {
    id: "s1",
    title: "Japan round-up",
    scope: { type: "country", id: "japan" },
    status: "draft",
    clipCount: 2,
    durationMs: 95_000,
    created: "2026-10-04T10:00:00.000Z",
    previewPlay: { sceneId: "shorts-preview", playNonce: 1, startedAt: 1, endedAt: 2, skipped: [{ id: "b", reason: "gone" }] },
  },
  { id: "s2", title: "World", scope: { type: "globe" }, status: "draft", clipCount: 1, durationMs: 30_000 },
];

const setup = (over: Partial<React.ComponentProps<typeof ScriptsTable>> = {}) => {
  const props = {
    scripts: rows,
    preview,
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
  const world = screen.getByText("World").closest("tr")!;
  expect(within(world).getByText("never played")).toBeInTheDocument();
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

it("disables Preview when the preview scene doesn't exist", () => {
  setup({ preview: { ...preview, exists: false } });
  for (const b of screen.getAllByRole("button", { name: "Preview" })) expect(b).toBeDisabled();
});

it("says so when there are no scripts", () => {
  setup({ scripts: [] });
  expect(screen.getByText(/No scripts yet/)).toBeInTheDocument();
});
