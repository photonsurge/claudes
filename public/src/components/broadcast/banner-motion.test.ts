import {
  DASH_MS,
  PULSE_MS,
  SPIN_MS,
  SWEEP_MS,
  drawBannerMotion,
  pulseOpacity,
  sweepOpacity,
  withAlpha,
} from "./banner-motion";

/** A 2D context stand-in that records every method call (property sets are accepted and dropped). */
function recorder() {
  const calls: Array<[string, unknown[]]> = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === "calls") return calls;
        if (k === "createLinearGradient" || k === "createRadialGradient") {
          return (...args: unknown[]) => {
            calls.push([String(k), args]);
            return { addColorStop: (o: number, c: string) => calls.push(["addColorStop", [o, c]]) };
          };
        }
        return (...args: unknown[]) => {
          calls.push([String(k), args]);
        };
      },
      set: () => true,
    },
  );
  return ctx as unknown as CanvasRenderingContext2D & { calls: Array<[string, unknown[]]> };
}

const OPTS = { accent: "#3fd0ff", border: "#1d4354", titleColor: "#e9f3f7", liveCore: false };

describe("banner-motion timing", () => {
  it("sweep opacity rises to 1 by 12% then fades linearly to 0", () => {
    expect(sweepOpacity(0)).toBe(0);
    expect(sweepOpacity(0.06)).toBeCloseTo(0.5);
    expect(sweepOpacity(0.12)).toBeCloseTo(1);
    expect(sweepOpacity(0.56)).toBeCloseTo(0.5);
    expect(sweepOpacity(1)).toBeCloseTo(0);
  });

  it("pulse dips from 1 to 0.25 at mid-cycle and back", () => {
    expect(pulseOpacity(0)).toBeCloseTo(1);
    expect(pulseOpacity(0.5)).toBeCloseTo(0.25);
    expect(pulseOpacity(1)).toBeCloseTo(1);
    // Ease-in-out: the quarter points sit halfway, not at the linear third.
    expect(pulseOpacity(0.25)).toBeCloseTo(0.625);
  });

  it("periods match the CSS animations they replace", () => {
    expect([SWEEP_MS, SPIN_MS, DASH_MS, PULSE_MS]).toEqual([5500, 42_000, 6000, 1800]);
  });

  it("withAlpha turns hex colours into rgba and leaves others alone", () => {
    expect(withAlpha("#3fd0ff", 0.5)).toBe("rgba(63,208,255,0.5)");
    expect(withAlpha("#fff", 1)).toBe("rgba(255,255,255,1)");
    expect(withAlpha("#3fd0ff80", 1)).toBe("rgba(63,208,255,0.502)");
    expect(withAlpha("rebeccapurple", 0.5)).toBe("rebeccapurple");
  });
});

describe("drawBannerMotion", () => {
  const names = (ctx: ReturnType<typeof recorder>) => ctx.calls.map(([n]) => n);

  it("paints the sweep, four bezel circles, six ticks, two orbit rings and the pulse", () => {
    const ctx = recorder();
    drawBannerMotion(ctx, 1234, OPTS);
    const n = names(ctx);
    // Sweep: clipped to the panel interior, gradient band, then the status square.
    expect(n.filter((x) => x === "fillRect")).toHaveLength(2);
    expect(n.filter((x) => x === "createLinearGradient")).toHaveLength(1);
    // Bezel: static r158/r152 + dotted r140 + thick r146 arcs.
    expect(n.filter((x) => x === "arc")).toHaveLength(4);
    expect(ctx.calls.filter(([x, a]) => x === "arc" && a[2] === 140)).toHaveLength(1);
    expect(ctx.calls.filter(([x, a]) => x === "arc" && a[2] === 146)).toHaveLength(1);
    // Orbit: the solid ring and the marching dashed one, both tilted -27°.
    const ellipses = ctx.calls.filter(([x]) => x === "ellipse");
    expect(ellipses).toHaveLength(2);
    for (const [, a] of ellipses) expect(a[4]).toBeCloseTo((-27 * Math.PI) / 180);
    // Dash patterns from the SVG.
    const dashes = ctx.calls.filter(([x]) => x === "setLineDash").map(([, a]) => a[0]);
    expect(dashes).toEqual(expect.arrayContaining([[2, 9], [36, 230], [30, 12]]));
    // No live core → nothing is clipped away from the orbit (only the sweep clips).
    expect(n.filter((x) => x === "clip")).toHaveLength(1);
  });

  it("hides the orbit's back arc behind a live core with an even-odd clip", () => {
    const ctx = recorder();
    drawBannerMotion(ctx, 0, { ...OPTS, liveCore: true });
    const clips = ctx.calls.filter(([x]) => x === "clip");
    expect(clips).toHaveLength(2);
    expect(clips[1][1]).toEqual(["evenodd"]);
    // The half-disc: an r=140 arc over the back half, in the tilted frame.
    expect(ctx.calls.filter(([x, a]) => x === "arc" && a[2] === 140 && a[3] === Math.PI)).toHaveLength(1);
  });

  it("uses the theme colours", () => {
    const ctx = recorder();
    drawBannerMotion(ctx, 0, { ...OPTS, accent: "#f43f5e" });
    const stops = ctx.calls.filter(([x]) => x === "addColorStop").map(([, a]) => a[1]);
    expect(stops).toEqual(["rgba(244,63,94,0)", "rgba(233,243,247,0.85)"]);
  });
});
