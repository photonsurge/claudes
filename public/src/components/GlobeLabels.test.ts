import { LabelGrid, labelWidth } from "./GlobeLabels";

describe("labelWidth", () => {
  it("grows with text length", () => {
    expect(labelWidth("A")).toBeLessThan(labelWidth("A Longer City Name"));
  });

  it("caps at a max width", () => {
    expect(labelWidth("A".repeat(200))).toBe(240);
  });
});

describe("LabelGrid", () => {
  it("reports no collision for an empty grid", () => {
    const grid = new LabelGrid();
    expect(grid.collides(0, 0, 50, 15)).toBe(false);
  });

  it("collides with an overlapping placed box", () => {
    const grid = new LabelGrid();
    grid.place(100, 100, 160, 115);
    expect(grid.collides(120, 105, 180, 120)).toBe(true);
  });

  it("does not collide with a far-away placed box", () => {
    const grid = new LabelGrid();
    grid.place(100, 100, 160, 115);
    expect(grid.collides(500, 500, 560, 515)).toBe(false);
  });

  it("does not collide with a box that only touches (no overlap area)", () => {
    const grid = new LabelGrid();
    grid.place(0, 0, 50, 15);
    expect(grid.collides(50, 0, 100, 15)).toBe(false);
  });

  it("clear() removes previously placed boxes", () => {
    const grid = new LabelGrid();
    grid.place(0, 0, 50, 15);
    grid.clear();
    expect(grid.collides(0, 0, 50, 15)).toBe(false);
  });

  it("detects collisions across grid-cell boundaries", () => {
    const grid = new LabelGrid();
    // A wide box spanning several 48px cells.
    grid.place(40, 0, 260, 15);
    expect(grid.collides(250, 0, 300, 15)).toBe(true);
  });
});
