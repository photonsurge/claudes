import { render, screen } from "@testing-library/react";
import RunTimelineEntry from "./RunTimelineEntry";
import type { AirEntry } from "../../lib/airlog";

const entry = (over: Partial<AirEntry> = {}): AirEntry => ({
  id: "e1",
  runId: "r1",
  sceneId: "default",
  seq: 3,
  kind: "quake",
  segmentId: "quake:us7000abcd",
  title: "Earthquake",
  subtitle: "M6.1 · Fiji",
  breaking: false,
  timesShown: 1,
  center: [178.1, -17.9],
  zoom: 5,
  holdMs: 45000,
  startedAt: "2026-07-08T11:00:00Z",
  endedAt: "2026-07-08T11:00:45Z",
  actualMs: 45000,
  endReason: "expired",
  ...over,
});

describe("RunTimelineEntry", () => {
  it("shows the cut number, kind, subject and real vs planned hold", () => {
    render(<RunTimelineEntry entry={entry()} isLast />);
    expect(screen.getByText("#3 quake")).toBeInTheDocument();
    expect(screen.getByText("Earthquake")).toBeInTheDocument();
    expect(screen.getByText("us7000abcd")).toBeInTheDocument();
    expect(screen.getByText(/45s of 45s/)).toBeInTheDocument();
  });

  it("marks operator skips and breaking-tier picks", () => {
    render(
      <RunTimelineEntry
        entry={entry({ breaking: true, actualMs: 12000, endReason: "skipped" })}
        isLast
      />,
    );
    expect(screen.getByText("⚡ breaking")).toBeInTheDocument();
    expect(screen.getByText(/skipped early/)).toBeInTheDocument();
  });

  it("links storm shots to the alert detail page", () => {
    render(
      <RunTimelineEntry
        entry={entry({ kind: "storm", segmentId: "storm:nws:urn:oid:123" })}
        isLast
      />,
    );
    const link = screen.getByRole("link", { name: "nws:urn:oid:123" });
    expect(link).toHaveAttribute("href", `/admin/alerts/${encodeURIComponent("nws:urn:oid:123")}`);
  });

  it("lists the sub-view stops a round-up shot tours through", () => {
    render(
      <RunTimelineEntry
        entry={entry({
          kind: "summary",
          segmentId: "summary:abc",
          title: "Global Round-Up",
          stops: [
            { label: "Southern Europe", subtitle: "Heat", lng: 14, lat: 41 },
            { label: "Bay of Bengal", lng: 89, lat: 18 },
          ],
        })}
        isLast
      />,
    );
    expect(screen.getByText(/Southern Europe/)).toBeInTheDocument();
    expect(screen.getByText(/Bay of Bengal/)).toBeInTheDocument();
  });
});
