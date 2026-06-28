import type { TleRecord } from "./types";

/**
 * Parse Celestrak TLE text into records. Handles the standard 3-line groups
 * (name, "1 …", "2 …") and tolerates a missing name line (2-line elements),
 * falling back to the catalog number. The NORAD id is columns 3–7 of line 1.
 */
export function parseTle(text: string): TleRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 0);

  const out: TleRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line1 = lines[i];
    const line2 = lines[i + 1];
    if (!line1.startsWith("1 ") || !line2 || !line2.startsWith("2 ")) continue;

    const prev = lines[i - 1];
    const hasName = i > 0 && !prev.startsWith("1 ") && !prev.startsWith("2 ");
    const noradId = line1.slice(2, 7).trim();
    out.push({
      name: (hasName ? prev : noradId).trim(),
      noradId,
      line1,
      line2,
    });
    i++; // consume line2
  }
  return out;
}
