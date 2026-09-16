"use client";

/**
 * "WARNING DETAIL" — what the on-air warning actually SAYS.
 *
 * Everything else in a storm deck is OUR description of the event: the
 * phrasebook title, the hazard type, the severity rank, a rollup of what else is
 * nearby. The CAP message's own content — what is happening, and what people
 * there are being told to do — reached `/admin` and went no further, so a
 * viewer got "SEVERE · Extreme Rainfall · 4/4" and no detail at all. This is
 * that missing page: the issuing authority's words, then the facts a viewer
 * needs to place them (who is under it, how long it runs, which areas).
 *
 * The text arrives on the focus bundle (`alertNarrative`), already
 * translation-resolved — a bulletin issued in Arabic shows its English
 * translation and says so; an English-language feed shows its own words, which
 * the old translated-field-only plumbing rendered as a blank.
 *
 * The body is deliberately allowed to be long: the deck scrolls an overflowing
 * card at the channel's reading pace and advances on the run, so a full
 * description is read out rather than clamped (see SLIDE_RUNS / readPaceCps).
 */
import type { AlertNarrative } from "@photonsurge/shared/alerts/narrative";
import type { AlertFeature } from "../../lib/alerts";
import { formatPeople } from "../../lib/alerts";
import { clampSentences } from "../../lib/text";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection, DIM } from "./BroadcastCard";

/** Longest run of prose a single block airs. Generous — the deck scrolls — but
 *  finite, because some feeds paste an entire regional forecast discussion into
 *  `description` and a card is not a document viewer. Cut to whole sentences. */
const MAX_PROSE = 900;

/** Areas listed as rows before the remainder becomes a count. */
const AREA_ROWS = 6;

/** Whether the warning says enough to earn its own slide. Prose only: the areas
 *  alone already ride the lede's subtitle. */
export function alertDetailSlideHasContent(narrative?: AlertNarrative | null): boolean {
  return Boolean(narrative && (narrative.description || narrative.instruction || narrative.headline));
}

/** "in 3 hours" / "in 45 minutes" / "shortly" — how long the warning still runs. */
function runsFor(expires?: string, nowMs = Date.now()): string | null {
  if (!expires) return null;
  const end = new Date(expires).getTime();
  if (!Number.isFinite(end)) return null;
  const mins = Math.round((end - nowMs) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** One prose block under its own micro-heading. */
function Prose({ eyebrow, text }: { eyebrow: string; text: string }) {
  return (
    <CardSection eyebrow={eyebrow} style={{ marginTop: 12 }}>
      <div style={{ fontSize: 15, lineHeight: 1.5, color: "#e6eefb", whiteSpace: "pre-line" }}>
        {clampSentences(text, MAX_PROSE)}
      </div>
    </CardSection>
  );
}

/** One label/value fact on the footer strip. */
function Fact({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: DIM }}>{label}</div>
      <div style={{ fontSize: 15.4, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

export default function AlertDetailPanel({
  narrative,
  alert,
  color = "#d23a3a",
  theme = DEFAULT_THEME,
  nowMs,
}: {
  narrative: AlertNarrative;
  /** The on-air alert itself (focus target) — carries the people estimate, the
   *  expiry and the issuing source. Absent when the bundle hasn't matched one. */
  alert?: AlertFeature | null;
  color?: string;
  theme?: BroadcastTheme;
  /** Injectable clock, for tests. */
  nowMs?: number;
}) {
  // Only facts the card header ISN'T already showing. The tracking readout above
  // the deck carries severity, type, level, country, source and how long the
  // warning has been running — repeating those here is exactly the padding that
  // made the old card read as detail-free.
  // The issuing authority, unless it just repeats the feed name we already show.
  const p0 = alert?.properties;
  const authority =
    narrative.sender && narrative.sender.toUpperCase() !== (p0?.source ?? "").toUpperCase()
      ? narrative.sender
      : undefined;
  const p = alert?.properties;
  const people = formatPeople(p?.population);
  const left = runsFor(p?.expires, nowMs);
  const facts: { label: string; value: string }[] = [];
  if (people) {
    const cities = p?.cityCount ?? 0;
    facts.push({
      label: "PEOPLE UNDER IT",
      value: cities > 0 ? `≈ ${people} · ${cities} cit${cities === 1 ? "y" : "ies"}` : `≈ ${people}`,
    });
  }
  if (left) facts.push({ label: "RUNS FOR ANOTHER", value: left });
  // CAP's own urgency/certainty — every adapter fills them and nothing on air
  // read them, though "is this happening now, and do they KNOW" is exactly what
  // a viewer wants from a warning.
  if (narrative.urgency) facts.push({ label: "URGENCY", value: narrative.urgency });
  if (narrative.certainty) facts.push({ label: "CONFIDENCE", value: narrative.certainty });

  return (
    <BroadcastCard accent={color} eyebrow="Warning Detail" theme={theme}>
      {/* A revision says so up front — a viewer should know they're seeing an
          upgraded warning rather than the original bulletin. */}
      {narrative.msgType ? (
        <div
          style={{
            display: "inline-block",
            marginBottom: 6,
            padding: "2px 7px",
            borderRadius: 3,
            background: color,
            color: "#08121a",
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          {narrative.msgType.toUpperCase()}
        </div>
      ) : null}

      {/* The authority's own headline, when it adds something past our title. */}
      {narrative.headline ? (
        <div style={{ fontSize: 17.6, fontWeight: 800, color: "#fff", lineHeight: 1.25, marginTop: 2 }}>
          {clampSentences(narrative.headline, 160)}
        </div>
      ) : null}

      {/* WHO is warning them. The header's SOURCE row names the aggregator we
          pulled from ("WMO"); this is the meteorological service that actually
          issued it, which is the attribution that means something on air. */}
      {authority ? (
        <div style={{ fontSize: 13.2, fontWeight: 700, color: DIM, marginTop: 4 }}>
          Issued by {authority}
        </div>
      ) : null}

      {narrative.description ? <Prose eyebrow="What's happening" text={narrative.description} /> : null}
      {narrative.instruction ? <Prose eyebrow="What to do" text={narrative.instruction} /> : null}

      {/* The places named by the bulletin — the list that used to arrive as one
          semicolon-joined run-on on the lede's subtitle. */}
      {narrative.areaCount > 0 ? (
        <CardSection
          eyebrow={
            narrative.areaCount > 1 ? `Areas named · ${narrative.areaCount}` : "Area named"
          }
          style={{ marginTop: 12 }}
        >
          <div style={{ fontSize: 14.3, lineHeight: 1.45, color: "#cdd9ec" }}>
            {narrative.areas.slice(0, AREA_ROWS).map((a) => (
              <div
                key={a}
                style={{ padding: "2px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {a}
              </div>
            ))}
            {narrative.areaCount > AREA_ROWS ? (
              <div style={{ padding: "2px 0", color: DIM, fontWeight: 700 }}>
                + {narrative.areaCount - AREA_ROWS} more
              </div>
            ) : null}
          </div>
        </CardSection>
      ) : null}

      {facts.length ? (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid rgba(120,140,170,0.15)",
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "8px 14px",
          }}
        >
          {facts.map((f) => (
            <Fact key={f.label} label={f.label} value={f.value} color={color} />
          ))}
        </div>
      ) : null}

      {/* Say when the words on screen are a translation rather than the
          authority's own — the viewer is reading a machine's English, not Riyadh's. */}
      {narrative.translated ? (
        <div style={{ marginTop: 10, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, color: DIM }}>
          TRANSLATED{narrative.language ? ` FROM ${narrative.language.toUpperCase()}` : ""}
        </div>
      ) : null}
    </BroadcastCard>
  );
}
