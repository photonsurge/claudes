import { SpriteAtlas, type AtlasPage } from "./label-atlas";

function fakePage(size: number): AtlasPage {
  return {
    canvas: { width: size, height: size } as HTMLCanvasElement,
    ctx: {} as CanvasRenderingContext2D,
    alive: true,
    shelves: [],
    nextY: 0,
  };
}

describe("SpriteAtlas", () => {
  it("packs sprites on shelves with a one-pixel gutter", () => {
    const a = new SpriteAtlas(64, 2, fakePage);
    const r1 = a.alloc(10, 6)!;
    expect([r1.sx, r1.sy, r1.sw, r1.sh]).toEqual([1, 1, 10, 6]);
    const r2 = a.alloc(10, 6)!; // same shelf, to the right
    expect([r2.sx, r2.sy]).toEqual([13, 1]);
    expect(r2.page).toBe(r1.page);
    const r3 = a.alloc(20, 20)!; // too tall for that shelf → a new shelf below
    expect([r3.sx, r3.sy]).toEqual([1, 9]);
    expect(a.pageCount).toBe(1);
  });

  it("opens a new page when the current one is full and retires the oldest past the limit", () => {
    const a = new SpriteAtlas(32, 2, fakePage);
    const first = a.alloc(30, 30)!; // fills page 1
    const second = a.alloc(30, 30)!; // page 2
    expect(second.page).not.toBe(first.page);
    expect(a.pageCount).toBe(2);
    expect(first.page.alive).toBe(true);
    const third = a.alloc(30, 30)!; // page 3 → page 1 retired
    expect(a.pageCount).toBe(2);
    expect(first.page.alive).toBe(false);
    expect(second.page.alive).toBe(true);
    expect(third.page.alive).toBe(true);
  });

  it("returns null for a sprite that can't fit a page, or when no page can be made", () => {
    expect(new SpriteAtlas(16, 1, fakePage).alloc(20, 4)).toBeNull();
    expect(new SpriteAtlas(16, 1, () => null).alloc(4, 4)).toBeNull();
  });
});
