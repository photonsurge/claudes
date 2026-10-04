import { phraseDecision } from "./engine";

const base = { hasPhrase: true, bar: 10, phraseEnd: 16, drifted: false, skip: false, hasTrack: true, far: false, trackLeft: 3 };

describe("phraseDecision", () => {
  it("keeps playing mid-phrase", () => {
    expect(phraseDecision(base)).toEqual({ start: false, newTrack: false });
  });

  it("starts the next phrase of the same track when one ends", () => {
    expect(phraseDecision({ ...base, bar: 16 })).toEqual({ start: true, newTrack: false });
  });

  it("starts a new track when the track is used up, the section jumped far, or there is none", () => {
    expect(phraseDecision({ ...base, bar: 16, trackLeft: 0 })).toEqual({ start: true, newTrack: true });
    expect(phraseDecision({ ...base, drifted: true, far: true })).toEqual({ start: true, newTrack: true });
    expect(phraseDecision({ ...base, hasPhrase: false, hasTrack: false })).toEqual({ start: true, newTrack: true });
  });

  it("cuts at a drift mark without a new track when the section is near", () => {
    expect(phraseDecision({ ...base, drifted: true })).toEqual({ start: true, newTrack: false });
  });

  it("a viewer's skip ends the phrase now and starts a new tune", () => {
    expect(phraseDecision({ ...base, skip: true })).toEqual({ start: true, newTrack: true });
  });
});
