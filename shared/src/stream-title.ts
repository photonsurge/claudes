/** Shared by the title preview and worker so server/browser time zones cannot disagree. */
export const STREAM_TITLE_TIMEZONE = "Europe/London";
export const STREAM_TITLE_TOKENS = [
  ["%d", "Day", "08"], ["%m", "Month", "09"],
  ["%Y", "Year", "2026"], ["%y", "Short year", "26"],
  ["%H", "Hour (24h)", "14"], ["%M", "Minute", "05"], ["%S", "Second", "09"],
  ["%I", "Hour (12h)", "02"], ["%p", "AM / PM", "PM"],
  ["%D", "Uppercase weekday", "TUESDAY"],
  ["%a", "Short weekday", "Tue"], ["%A", "Weekday", "Tuesday"],
  ["%b", "Short month", "Sept"], ["%B", "Month name", "September"],
  ["%e", "Day without zero", "8"], ["%j", "Day of year", "251"], ["%u", "Weekday (Mon=1)", "2"],
  ["%Z", "Timezone", "BST"], ["%z", "UTC offset", "+0100"],
  ["%F", "ISO date", "2026-09-08"], ["%R", "Hours & minutes", "14:05"], ["%T", "Time with seconds", "14:05:09"],
  ["%%", "Percent sign", "%"],
] as const;

/**
 * The value of every single-letter date code (keyed without the `%`, plus `%`
 * itself) for `date` in `timeZone` (an IANA zone). Shared with ./video-text so
 * live titles and video titles read the same table. Throws a RangeError for a
 * zone Intl does not know.
 */
export function dateCodeValues(date: Date, timeZone: string = STREAM_TITLE_TIMEZONE): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const name = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(date);
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
    .formatToParts(date).find((p) => p.type === "timeZoneName")!.value;
  const localDay = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  const dayOfYear = Math.floor((localDay - Date.UTC(Number(values.year), 0, 1)) / 86_400_000) + 1;
  const offsetMinutes = Math.round((localDay + (Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second)) * 1000 - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    d: values.day, m: values.month, Y: values.year, y: values.year.slice(-2),
    H: values.hour, M: values.minute, S: values.second,
    I: pad(Number(values.hour) % 12 || 12), p: Number(values.hour) < 12 ? "AM" : "PM",
    D: name({ weekday: "long" }).toUpperCase(),
    a: name({ weekday: "short" }), A: name({ weekday: "long" }),
    b: name({ month: "short" }), B: name({ month: "long" }), "%": "%",
    e: String(Number(values.day)), j: String(dayOfYear).padStart(3, "0"), u: String(new Date(localDay).getUTCDay() || 7),
    Z: zone, z: `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}${pad(Math.abs(offsetMinutes) % 60)}`,
    F: `${values.year}-${values.month}-${values.day}`, R: `${values.hour}:${values.minute}`, T: `${values.hour}:${values.minute}:${values.second}`,
  };
}

/** Expand the date codes in a live title. `timeZone` is an IANA zone, London by default. */
export function formatStreamTitle(template: string, date: Date = new Date(), timeZone: string = STREAM_TITLE_TIMEZONE): string {
  const tokens = dateCodeValues(date, timeZone);
  // Single pass: %%d is literal %d, never expanded a second time.
  return template.replace(/%([%a-zA-Z])/g, (match, key: string) => tokens[key] ?? match);
}
