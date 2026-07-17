import { clampSentences } from "./text";

describe("clampSentences", () => {
  it("returns short text unchanged", () => {
    expect(clampSentences("A tiny blurb.", 100)).toBe("A tiny blurb.");
  });

  it("trims trailing whitespace on short text", () => {
    expect(clampSentences("  Padded.  ", 100)).toBe("Padded.");
  });

  it("cuts at the last complete sentence within the budget", () => {
    const text =
      "Astana is the capital city of Kazakhstan. The city lies on the banks of the Ishim river. Initially founded as Aqmoly in 1830, the city was later renamed.";
    expect(clampSentences(text, 100)).toBe(
      "Astana is the capital city of Kazakhstan. The city lies on the banks of the Ishim river.",
    );
  });

  it("keeps just the first sentence when only it fits", () => {
    const text = "First sentence here. Second sentence is much longer and does not fit at all.";
    expect(clampSentences(text, 30)).toBe("First sentence here.");
  });

  it("does not treat abbreviations followed by lowercase as boundaries", () => {
    const text =
      "Alaska is a U.S. state on the northwest extremity of North America. It borders British Columbia to the east and it also shares a maritime border with Russia.";
    expect(clampSentences(text, 80)).toBe(
      "Alaska is a U.S. state on the northwest extremity of North America.",
    );
  });

  it("handles sentences ending before a quoted opener", () => {
    const text = 'The town is small. "Big things happen here anyway," locals say about it regardless.';
    expect(clampSentences(text, 40)).toBe("The town is small.");
  });

  it("falls back to a word cut + ellipsis when no sentence fits", () => {
    const text =
      "One enormous unbroken opening sentence that keeps going far beyond any reasonable budget without ever stopping for punctuation of any kind";
    const out = clampSentences(text, 60);
    expect(out.length).toBeLessThanOrEqual(61); // cut + "…"
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe("One enormous unbroken opening sentence that keeps going far…");
  });

  it("question and exclamation marks end sentences", () => {
    const text = "Is it windy? Yes! The gusts reached ninety knots during the storm last night.";
    expect(clampSentences(text, 20)).toBe("Is it windy? Yes!");
  });
});
