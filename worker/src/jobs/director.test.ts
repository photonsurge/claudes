import { DEFAULT_KIND_SLIDES, type KindSlide } from "@photonsurge/shared/director";
import { migrateLegacyQuakeSlides } from "./director";

describe("director slide migrations", () => {
  it("replaces the retired seeded quake magnetic slide and preserves custom slides", () => {
    const custom: KindSlide = { id: "custom", name: "My look", look: {}, overlays: {} };
    const legacy: KindSlide = {
      id: "quake-magnetic-signature",
      name: "Magnetic Signature",
      look: { basemap: "dark" },
      overlays: { showSeismic: true, showMagneticField: true },
    };

    const migrated = migrateLegacyQuakeSlides([custom, legacy]);

    expect(migrated).toContain(custom);
    expect(migrated.some((slide) => slide.id === legacy.id)).toBe(false);
    expect(migrated).toEqual(expect.arrayContaining(DEFAULT_KIND_SLIDES.quake ?? []));
    expect(migrated.some((slide) => slide.overlays.showMagneticField)).toBe(false);
  });

  it("does not rewrite a quake library with no retired seed slide", () => {
    const slides = DEFAULT_KIND_SLIDES.quake ?? [];
    expect(migrateLegacyQuakeSlides(slides)).toBe(slides);
  });
});
