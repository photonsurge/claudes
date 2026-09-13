/**
 * Honest time-window labels for the broadcast sparklines.
 *
 * The trend charts used to hard-code their horizon — a section headed "Next 72
 * Hours" over rows labelled "TEMP · 72H" — while the series actually plotted was
 * whatever the rolling forecast store happened to hold at cut time. Those two
 * drift apart constantly: elapsed frames are only pruned when the archive job
 * runs, so a card can plot hours that have already HAPPENED, and a thin store
 * plots far fewer hours than the horizon it claims.
 *
 * So the window is read off the points themselves: how many hours the drawn
 * trace really covers, and whether it runs forward from now (a forecast) or back
 * from it (history). Charts that genuinely look ahead still read "NEXT"; ones
 * whose data is behind us say "LAST" instead of over-claiming a forecast.
 */

const HOUR_MS = 3_600_000;
/** The longest window still worth naming in hours — the detailed 3-day horizon
 *  every forecast and history card is cut to. */
const HOURS_AS_HOURS = 72;

export interface ChartWindow {
  /** Compact tag for a chart label: "NEXT 72H" / "LAST 18H". */
  tag: string;
  /** Title-case heading for a card section: "Next 72 Hours" / "Last 18 Hours". */
  title: string;
  /** True when the trace reaches further ahead of `now` than behind it. */
  forward: boolean;
  /** Whole hours the label claims (at least 1). */
  hours: number;
}

/** A point only counts towards the window if it would actually be drawn — the
 *  same finite-value guard `sparkPoints` uses to lay the trace out. */
const drawn = (points: { t: string; value: number | null }[]): number[] =>
  points
    .filter((p) => p.value != null && Number.isFinite(p.value))
    .map((p) => new Date(p.t).getTime())
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);

/**
 * The window a series covers, or null when there's nothing plottable (fewer
 * than the two finite readings a trace needs).
 *
 * A series that straddles `now` is named for whichever side it reaches further
 * into: three days of forecast with a stale hour on the front is still "NEXT
 * 72H", while a run that has almost entirely elapsed reads "LAST 60H".
 */
export function chartWindow(
  points: { t: string; value: number | null }[],
  now: number = Date.now(),
): ChartWindow | null {
  const ts = drawn(points);
  if (ts.length < 2) return null;

  const ahead = (ts[ts.length - 1] - now) / HOUR_MS;
  const behind = (now - ts[0]) / HOUR_MS;
  const forward = ahead >= behind;
  const hours = Math.max(1, Math.round(forward ? ahead : behind));
  const word = forward ? "Next" : "Last";
  const { short, long } = spell(hours);

  return {
    tag: `${word.toUpperCase()} ${short}`,
    title: `${word} ${long}`,
    forward,
    hours,
  };
}

/** Past the detailed horizon an hour count stops reading as a duration ("LAST
 *  1797H"), so a long window is spelled in days instead. */
function spell(hours: number): { short: string; long: string } {
  if (hours <= HOURS_AS_HOURS) return { short: `${hours}H`, long: `${hours} ${hours === 1 ? "Hour" : "Hours"}` };
  const days = Math.max(1, Math.round(hours / 24));
  return { short: `${days}D`, long: `${days} ${days === 1 ? "Day" : "Days"}` };
}

/** The window covering every one of `series` at once — used for the section
 *  heading over a stack of charts whose individual spans differ (a variable the
 *  store is missing frames for ends earlier than the rest). */
export function chartWindowAcross(
  series: { t: string; value: number | null }[][],
  now: number = Date.now(),
): ChartWindow | null {
  return chartWindow(series.flat(), now);
}
