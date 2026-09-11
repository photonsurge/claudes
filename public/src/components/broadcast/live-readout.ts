/**
 * The masthead's live status readout — a tiny external store the locator globe
 * publishes into and GodsBanner subscribes to.
 *
 * WHY a store instead of props: SubGlobeWidget moves the planet ~12×/s and does
 * it imperatively on purpose (nothing there re-renders React per tick). Feeding
 * that position down as a prop would re-render the banner — and the whole brand
 * column — at the same rate. The store coalesces updates to `minIntervalMs`
 * (4 Hz by default, a beat faster than the banner's 1 Hz clock) and drops
 * no-op updates entirely, so a parked shot costs nothing at all.
 */

export interface BannerReadout {
  lat: number;
  lon: number;
  /** Continent under the locator globe, null when it is over open ocean. */
  continent?: string | null;
  /** Country under the locator globe, null when it is over open ocean. */
  country?: string | null;
}

export interface ReadoutStore {
  /** Latest value — stable by identity until it actually changes. */
  get(): BannerReadout | null;
  /** Publish a position; identical values (to the displayed precision) are dropped. */
  set(next: BannerReadout | null): void;
  subscribe(listener: () => void): () => void;
  /** Cancel a pending trailing notify (unmount / tests). */
  dispose(): void;
}

/** Displayed precision: the banner prints 3 dp, so finer moves are invisible. */
function same(a: BannerReadout | null, b: BannerReadout | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.lat.toFixed(3) === b.lat.toFixed(3) &&
    a.lon.toFixed(3) === b.lon.toFixed(3) &&
    (a.continent ?? null) === (b.continent ?? null) &&
    (a.country ?? null) === (b.country ?? null)
  );
}

export function createReadoutStore(
  initial: BannerReadout | null = null,
  minIntervalMs = 250,
): ReadoutStore {
  let current = initial;
  let lastNotifyAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    timer = null;
    lastNotifyAt = Date.now();
    for (const listener of listeners) listener();
  };

  return {
    get: () => current,
    set(next) {
      if (same(next, current)) return;
      current = next;
      if (timer) return; // a trailing notify is already queued — it will carry this value
      const wait = minIntervalMs - (Date.now() - lastNotifyAt);
      if (wait <= 0) notify();
      else timer = setTimeout(notify, wait);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      listeners.clear();
    },
  };
}
