import { render, screen } from "@testing-library/react";
import AlertDetailPanel, { alertDetailSlideHasContent } from "./AlertDetailPanel";
import { buildAlertNarrative } from "@photonsurge/shared/alerts/narrative";
import type { AlertFeature } from "../../lib/alerts";

/** The bulletin that exposed the gap: WMO, already in English, whole footprint
 *  in one semicolon-joined areaDesc. */
const saudi = buildAlertNarrative({
  headline: "Extreme Rainfall",
  description: "Heavy rainfall expected over the Asir highlands, 40-60mm in 24 hours.",
  instruction: "Avoid valleys and wadis. Do not cross flooded roads.",
  translatedHeadline: "",
  translatedDescription: "",
  translatedInstruction: "",
  area: [
    {
      areaDesc:
        "Asir region - Abha : The entire governorate; Asir region - Ahad Rufaydah : The entire governorate; Asir region - Khamis Mushait : The entire governorate",
    },
  ],
})!;

const NOW = Date.parse("2026-09-16T04:30:00Z");

const alert = {
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [] },
  properties: {
    id: "a1",
    source: "wmo",
    identifier: "sa-ncm-en/x",
    event: "Extreme Rainfall",
    severityRank: 4,
    hazard: "rain",
    population: 2_100_000,
    cityCount: 8,
    expires: "2026-09-16T07:00:00Z",
  },
} as unknown as AlertFeature;

it("puts the authority's own words on air — the text that never reached the deck", () => {
  render(<AlertDetailPanel narrative={saudi} alert={alert} nowMs={NOW} />);
  expect(screen.getByText(/Heavy rainfall expected over the Asir highlands/)).toBeInTheDocument();
  expect(screen.getByText(/Avoid valleys and wadis/)).toBeInTheDocument();
  expect(screen.getByText("What's happening")).toBeInTheDocument();
  expect(screen.getByText("What to do")).toBeInTheDocument();
});

it("lists the areas the one semicolon dump actually named", () => {
  render(<AlertDetailPanel narrative={saudi} alert={alert} nowMs={NOW} />);
  expect(screen.getByText("Areas named · 3")).toBeInTheDocument();
  expect(screen.getByText("Asir region - Abha : The entire governorate")).toBeInTheDocument();
});

it("adds the facts the card header does NOT already carry, and repeats none it does", () => {
  render(<AlertDetailPanel narrative={saudi} alert={alert} nowMs={NOW} />);
  expect(screen.getByText("PEOPLE UNDER IT")).toBeInTheDocument();
  expect(screen.getByText("≈ 2.1M · 8 cities")).toBeInTheDocument();
  expect(screen.getByText("RUNS FOR ANOTHER")).toBeInTheDocument();
  expect(screen.getByText("2h 30m")).toBeInTheDocument();
  // Severity / type / source ride the persistent tracking header above the deck.
  expect(screen.queryByText("SEVERITY")).not.toBeInTheDocument();
  expect(screen.queryByText(/^ISSUED BY$/)).not.toBeInTheDocument();
});

it("airs the CAP urgency + certainty, the issuing authority and an update badge", () => {
  const n = buildAlertNarrative(
    { description: "Heavy rain.", urgency: "Immediate", certainty: "Observed" },
    { sender: "Saudi Arabia National Center for Meteorology", msgType: "Update" },
  )!;
  render(<AlertDetailPanel narrative={n} alert={alert} nowMs={NOW} />);
  expect(screen.getByText("URGENCY")).toBeInTheDocument();
  expect(screen.getByText("Immediate")).toBeInTheDocument();
  expect(screen.getByText("CONFIDENCE")).toBeInTheDocument();
  expect(screen.getByText("Observed")).toBeInTheDocument();
  expect(screen.getByText("UPDATE")).toBeInTheDocument();
  expect(screen.getByText("Issued by Saudi Arabia National Center for Meteorology")).toBeInTheDocument();
});

it("does not re-attribute to the aggregator the header already names", () => {
  // WMO's adapter falls back to sender:"WMO" when it has no authority — the
  // card already says SOURCE WMO, so an "Issued by WMO" line adds nothing.
  const n = buildAlertNarrative({ description: "Heavy rain." }, { sender: "wmo" })!;
  render(<AlertDetailPanel narrative={n} alert={alert} nowMs={NOW} />);
  expect(screen.queryByText(/Issued by/)).not.toBeInTheDocument();
});

it("says so when the words are a machine translation, and stays quiet when they aren't", () => {
  const arabic = buildAlertNarrative({
    headline: "أمطار غزيرة",
    description: "الوصف",
    translatedHeadline: "Heavy rainfall",
    translatedDescription: "Heavy rain expected.",
    detectedLanguage: "ar",
  })!;
  const { rerender } = render(<AlertDetailPanel narrative={arabic} nowMs={NOW} />);
  expect(screen.getByText("TRANSLATED FROM AR")).toBeInTheDocument();
  rerender(<AlertDetailPanel narrative={saudi} nowMs={NOW} />);
  expect(screen.queryByText(/TRANSLATED/)).not.toBeInTheDocument();
});

it("drops the expiry fact once the warning has run out rather than counting backwards", () => {
  render(<AlertDetailPanel narrative={saudi} alert={alert} nowMs={Date.parse("2026-09-16T09:00:00Z")} />);
  expect(screen.queryByText("RUNS FOR ANOTHER")).not.toBeInTheDocument();
  expect(screen.getByText("PEOPLE UNDER IT")).toBeInTheDocument();
});

it("renders without an alert match (bundle target missing) — prose still airs", () => {
  render(<AlertDetailPanel narrative={saudi} alert={null} nowMs={NOW} />);
  expect(screen.getByText(/Heavy rainfall expected/)).toBeInTheDocument();
  expect(screen.queryByText("PEOPLE UNDER IT")).not.toBeInTheDocument();
});

describe("alertDetailSlideHasContent", () => {
  it("earns a slide on prose, never on a bare areas list", () => {
    expect(alertDetailSlideHasContent(saudi)).toBe(true);
    expect(alertDetailSlideHasContent(buildAlertNarrative({ area: [{ areaDesc: "Kraków" }] }))).toBe(false);
    expect(alertDetailSlideHasContent(null)).toBe(false);
  });
});
