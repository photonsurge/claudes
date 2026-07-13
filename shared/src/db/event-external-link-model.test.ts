import { EventExternalLinkSchema, type iEventExternalLink } from "./event-external-link-model";

describe("EventExternalLinkSchema", () => {
  it("persists every iEventExternalLink field", () => {
    const sample: Omit<iEventExternalLink, "id" | "created" | "updated"> = {
      eventId: "evt-1",
      source: "reliefweb",
      externalId: "disaster-56789",
      matchMethod: "GLIDE",
      matchScore: 0.92,
      linkedAt: "2026-07-12T14:00:00Z",
    };
    const persisted = new Set(Object.keys(EventExternalLinkSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
