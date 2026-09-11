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

  it("takes a rail label, a seek button and a note for the VOD page", () => {
    const onSeek = jest.fn();
    render(<RunTimelineEntry entry={entry()} isLast railLabel="1:23:45" onSeek={onSeek} note="joined in progress" />);
    expect(screen.getByText("1:23:45")).toBeInTheDocument();
    expect(screen.queryByText("11:00:00")).not.toBeInTheDocument();
    expect(screen.getByText("joined in progress")).toBeInTheDocument();
    screen.getByRole("button", { name: "Play from 1:23:45" }).click();
    expect(onSeek).toHaveBeenCalled();
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

  it("prefixes each round-up stop with its estimated offset when given a stop rail", () => {
    render(
      <RunTimelineEntry
        entry={entry({ stops: [{ label: "Tokyo", lng: 139.7, lat: 35.7 }] })}
        isLast
        stopRail={[{ label: "≈1:30" }]}
      />,
    );
    expect(screen.getByText("≈1:30")).toBeInTheDocument();
  });

  it("can render subjects as plain text for public surfaces", () => {
    render(<RunTimelineEntry entry={entry({ kind: "storm", segmentId: "storm:nws:urn:oid:123" })} isLast subjectLinks={false} />);
    expect(screen.getByText("nws:urn:oid:123")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "nws:urn:oid:123" })).not.toBeInTheDocument();
  });

  it("lists the sub-view stops a round-up shot tours through", () => {
    render(
      <RunTimelineEntry
        entry={entry({
          kind: "global",
          segmentId: "global:abc",
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
