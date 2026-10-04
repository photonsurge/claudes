import { render, screen } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import BreakInItemsPanel, { MAX_BREAK_IN_ROWS } from "./BreakInItemsPanel";

const seg = (n: number): Segment =>
  ({
    id: "storm:breakin-a",
    kind: "storm",
    title: `${n} NEW SEVERE WARNINGS`,
    camera: { center: [0, 0], zoom: 3 },
    patch: {},
    holdMs: 1,
    breakIn: {
      reason: "storm",
      interrupted: true,
      items: Array.from({ length: n }, (_, i) => ({ segmentId: `storm:${i}`, title: `Warning ${i}`, subtitle: i === 0 ? "Bavaria" : undefined })),
    },
  }) as Segment;

it("lists every member under the group title", () => {
  render(<BreakInItemsPanel segment={seg(3)} color="#f97316" />);
  expect(screen.getByText("3 NEW SEVERE WARNINGS")).toBeInTheDocument();
  expect(screen.getByText("Warning 0")).toBeInTheDocument();
  expect(screen.getByText("Bavaria")).toBeInTheDocument();
  expect(screen.getByText("Warning 2")).toBeInTheDocument();
});

it("counts the rest past the row limit", () => {
  render(<BreakInItemsPanel segment={seg(MAX_BREAK_IN_ROWS + 3)} color="#f97316" />);
  expect(screen.getByText("and 3 more")).toBeInTheDocument();
  expect(screen.queryByText(`Warning ${MAX_BREAK_IN_ROWS}`)).not.toBeInTheDocument();
});

it("renders nothing for a single break-in", () => {
  const { container } = render(<BreakInItemsPanel segment={seg(1)} color="#f97316" />);
  expect(container).toBeEmptyDOMElement();
});
