/**
 * Which copy of the stack am I looking at?
 *
 * Three deployments now run the same code — this laptop, the test box (miranda,
 * images `:test`) and the live box (asguard, images `:latest`) — and the
 * operator surfaces look identical on all three. That is how you end up
 * reseeding cities on live because the tab looked like the test one.
 *
 * So every operator surface washes its page ground with the instance's own
 * colour and rides a label in the chrome. /watch is deliberately NOT one of
 * them: nothing in here may ever reach the broadcast output.
 *
 * WHY THIS IS A RUNTIME VALUE, NOT `NEXT_PUBLIC_*`
 * ./deployLive promotes the very image miranda tested to live, byte for byte,
 * and Next inlines NEXT_PUBLIC_* at BUILD time — so a build-time flag would
 * label live "TEST" forever. Everything here is read from the server env at
 * request time, the same trick SOCKET_PUBLIC_URL uses. The corollary: a surface
 * that PAINTS this must render dynamically (its route exports
 * `dynamic = "force-dynamic"`, or it already reads cookies like /admin does).
 * A statically prerendered page would bake in whatever the build box had.
 *
 * ZERO CONFIG BY DEFAULT
 * ./deploy pins `TAG=` into the env it syncs to each host (test box = test,
 * live box = latest) and compose passes the whole .env into the container, so
 * TAG alone already tells the three apart — no TAG at all means a dev machine.
 * INSTANCE_ID / INSTANCE_LABEL / INSTANCE_COLOR only override that guess, and
 * INSTANCE_ID=off turns the whole thing back off.
 */

/**
 * Just the shape we read. Deliberately looser than `NodeJS.ProcessEnv` (whose
 * Next-augmented form insists on NODE_ENV) so a test can hand over two keys.
 */
type Env = Record<string, string | undefined>;

export const INSTANCE_IDS = ["local", "test", "live"] as const;
export type InstanceId = (typeof INSTANCE_IDS)[number];

/** A resolved instance identity: what to call it and what colour it wears. */
export type Instance = {
  id: InstanceId;
  /** Short all-caps badge text, e.g. "TEST". */
  label: string;
  /** `#rrggbb` — the identity colour everything else is derived from. */
  color: string;
};

/**
 * The identity colours: deep purple for live, and two hues nowhere near it.
 *
 * Deliberately NOT the brand accent (#38bdf8, see theme/tokens.ts) — the tint
 * has to read as chrome saying "which box", never as product content — and
 * deliberately three different HUES rather than three shades, because at 12%
 * over a near-black ground a shade difference disappears and a hue difference
 * doesn't. Teal is far enough off the brand sky blue to not be mistaken for it,
 * and off the status green (#22c55e) to not read as "all healthy".
 */
export const INSTANCE_COLOR: Record<InstanceId, string> = {
  local: "#14b8a6",
  test: "#f59e0b",
  live: "#7c3aed",
};

export const INSTANCE_LABEL: Record<InstanceId, string> = {
  local: "LOCAL",
  test: "TEST",
  live: "LIVE",
};

/** Percent of the instance colour mixed into a page ground / a panel. */
export const PAGE_TINT = 12;
export const PANEL_TINT = 7;
/** …and into the small plate the label chip sits on (it wants to be readable). */
export const PLATE_TINT = 20;

/** The un-tinted grounds the operator pages (home, /control, /login) paint. */
export const BASE_PAGE = "#0a0e16";
export const BASE_PANEL = "#0c111c";

/**
 * `#abc` / `#AABBCC` → `#aabbcc`, anything else → null.
 *
 * These values come from a host env file and end up in a `style` attribute, so
 * they get validated rather than trusted: a typo should fall back to the
 * default colour, not emit a broken (or invented) CSS declaration.
 */
export function normalizeHex(value: string | undefined | null): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

/**
 * Blend `pct`% of `over` into `base`, both `#rrggbb`.
 *
 * Done in JS rather than with CSS `color-mix()` on purpose: the result is a
 * plain hex that any call site can drop into an inline style, it is testable,
 * and a missing custom property can never collapse a background to transparent.
 */
export function mixHex(base: string, over: string, pct: number): string {
  const a = normalizeHex(base);
  const b = normalizeHex(over);
  if (!a || !b) return base;
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const channel = (i: number) => {
    const from = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
    const to = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/**
 * The zero-config guess: the image tag the stack was deployed with.
 * No tag = nobody deployed this, so it's a dev machine.
 */
export function instanceFromTag(tag: string | undefined | null): InstanceId {
  const t = (tag ?? "").trim().toLowerCase();
  if (!t) return "local";
  if (t === "test") return "test";
  // `latest` and any pinned version tag (1.4.2) are both "a real deployment".
  return "live";
}

/**
 * Read the instance identity out of the server environment.
 *
 * Returns null when the chrome is switched off (INSTANCE_ID=off), in which case
 * every call site keeps the colours it had — they all read the tint through a
 * `var(--inst-*, <original>)` fallback.
 */
export function resolveInstance(env: Env = process.env): Instance | null {
  const raw = (env.INSTANCE_ID ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "none") return null;

  const id = (INSTANCE_IDS as readonly string[]).includes(raw)
    ? (raw as InstanceId)
    : instanceFromTag(env.TAG);

  const label = (env.INSTANCE_LABEL ?? "").trim().slice(0, 16) || INSTANCE_LABEL[id];
  const color = normalizeHex(env.INSTANCE_COLOR) ?? INSTANCE_COLOR[id];
  return { id, label, color };
}

/** The plate a label chip sits on — dark enough to keep the label legible. */
export function plateFor(color: string): string {
  return mixHex(BASE_PAGE, color, PLATE_TINT);
}

/**
 * The custom properties an operator surface hangs on itself (or on a
 * `display: contents` wrapper — see InstanceSurface).
 *
 * Each surface then paints `var(--inst-page, #0a0e16)` (or `--inst-panel`), so
 * it keeps its designed colour anywhere the variables are absent — the chrome
 * switched off, or a page that never opted in. Deliberately NOT set once on
 * <body> in the root layout: /watch renders through that layout too, and it is
 * prerendered, so the whole app would carry the BUILD box's identity.
 */
export function instanceVars(instance: Instance | null): Record<string, string> {
  if (!instance) return {};
  return {
    "--inst-color": instance.color,
    "--inst-page": mixHex(BASE_PAGE, instance.color, PAGE_TINT),
    "--inst-panel": mixHex(BASE_PANEL, instance.color, PANEL_TINT),
    "--inst-plate": plateFor(instance.color),
  };
}
