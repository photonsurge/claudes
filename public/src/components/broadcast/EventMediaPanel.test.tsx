import { render } from "@testing-library/react";
import EventMediaPanel, { eventMediaSlideHasContent } from "./EventMediaPanel";
import type { EventSnapshotMeta } from "@photonsurge/shared/db/event-snapshot-repo";
import type { iEventResource } from "@photonsurge/shared/db/event-resource-model";

const resources = [
  { id: "r1", eventId: "e1", source: "copernicus", url: "https://x/EMSR847/DEL.pdf", kind: "MAP", title: "Delineation map", sourceName: "Copernicus EMS", rebroadcastSafe: false, discoveredAt: "x", lastSeenAt: "x" },
] as unknown as iEventResource[];

const snaps = [
  { id: "s1", eventId: "e1", source: "gdacs", kind: "satellite", capturedAt: "2026-07-12T15:00:00Z", observationTime: "2026-07-12T00:00:00Z", width: 1024, height: 768 },
] as unknown as EventSnapshotMeta[];

describe("eventMediaSlideHasContent", () => {
  it("earns a slide on snapshots OR resources alone", () => {
    expect(eventMediaSlideHasContent(snaps, [])).toBe(true);
    expect(eventMediaSlideHasContent([], resources)).toBe(true);
    expect(eventMediaSlideHasContent([], [])).toBe(false);
    expect(eventMediaSlideHasContent(undefined, undefined)).toBe(false);
  });
});

describe("EventMediaPanel", () => {
  it("renders official products with their source, even without a snapshot", () => {
    const { getByText } = render(<EventMediaPanel resources={resources} />);
    expect(getByText("Delineation map")).toBeTruthy();
    expect(getByText("Copernicus EMS")).toBeTruthy();
    expect(getByText("[MAP]")).toBeTruthy();
  });

  it("renders the hero snapshot image when present", () => {
    const { container } = render(<EventMediaPanel snapshots={snaps} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("/api/events/snapshot/s1");
  });

  it("renders nothing with no media", () => {
    const { container } = render(<EventMediaPanel />);
    expect(container.firstChild).toBeNull();
  });
});
