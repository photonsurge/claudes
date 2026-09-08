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

export function formatStreamTitle(template: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STREAM_TITLE_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const name = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: STREAM_TITLE_TIMEZONE, ...options }).format(date);
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone: STREAM_TITLE_TIMEZONE, timeZoneName: "short" })
    .formatToParts(date).find((p) => p.type === "timeZoneName")!.value;
  const localDay = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  const dayOfYear = Math.floor((localDay - Date.UTC(Number(values.year), 0, 1)) / 86_400_000) + 1;
  const offsetMinutes = Math.round((localDay + (Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second)) * 1000 - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const tokens: Record<string, string> = {
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
  // Single pass: %%d is literal %d, never expanded a second time.
  return template.replace(/%([%a-zA-Z])/g, (match, key: string) => tokens[key] ?? match);
}
