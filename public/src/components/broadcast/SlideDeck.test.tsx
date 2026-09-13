import { act, render, screen } from "@testing-library/react";
import SlideDeck, { type DeckSlide } from "./SlideDeck";

const slides: DeckSlide[] = [
  { id: "a", node: <div>slide-a</div> },
  { id: "b", node: <div>slide-b</div> },
  { id: "c", node: <div>slide-c</div> },
];

/** The wrapper SlideDeck puts around a mounted slide, or null while it's unmounted. */
const wrapper = (id: string) => screen.queryByText(`slide-${id}`)?.parentElement ?? null;
const mounted = (id: string) => wrapper(id) !== null;
/** `content-visibility: hidden` — the engine skips the slide's layout and paint. */
const skipped = (id: string) => wrapper(id)?.style.contentVisibility === "hidden";
const active = () => slides.find((s) => wrapper(s.id)?.getAttribute("aria-hidden") === "false")?.id;

describe("SlideDeck", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("renders nothing for an empty deck", () => {
    const { container } = render(<SlideDeck slides={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single slide with no rotation chrome (dots)", () => {
    render(<SlideDeck slides={[slides[0]]} />);
    expect(screen.getByText("slide-a")).toBeInTheDocument();
  });

  it("mounts only the on-air slide and the one up next at a cut; the rest mount as they come up", () => {
    render(<SlideDeck slides={slides} holdMs={1000} />);
    expect(mounted("a")).toBe(true);
    expect(mounted("b")).toBe(true); // up next — its fetches get a whole hold to land
    expect(mounted("c")).toBe(false);
    act(() => void jest.advanceTimersByTime(1000)); // b airs, c is up next
    expect(mounted("c")).toBe(true);
  });

  it("keeps a slide mounted once it has aired, so panel state survives the rotation", () => {
    render(<SlideDeck slides={slides} holdMs={1000} />);
    // One hold per act(): the deck re-arms its clock on the commit that shows
    // the next slide (it is no longer a free-running interval), so the advances
    // have to be flushed one at a time.
    act(() => void jest.advanceTimersByTime(1000)); // a → b
    act(() => void jest.advanceTimersByTime(1000)); // b → c
    expect(active()).toBe("c");
    expect(mounted("a")).toBe(true);
    expect(mounted("b")).toBe(true);
  });

  it("skips layout of mounted off-air slides, except the one still fading out", () => {
    render(<SlideDeck slides={slides} holdMs={1000} />);
    expect(skipped("a")).toBe(false); // on air
    expect(skipped("b")).toBe(true); // waiting, never shown
    act(() => void jest.advanceTimersByTime(1000)); // b on air
    expect(skipped("a")).toBe(false); // fading out — has to render to be seen fading
    expect(skipped("b")).toBe(false);
    expect(skipped("c")).toBe(true);
    act(() => void jest.advanceTimersByTime(1000)); // c on air
    expect(skipped("a")).toBe(true); // its fade is long over
    expect(skipped("b")).toBe(false); // now the one fading out
  });

  it("advances the active slide on the hold timer and wraps around", () => {
    render(<SlideDeck slides={slides} holdMs={1000} />);
    expect(active()).toBe("a");
    act(() => void jest.advanceTimersByTime(1000));
    expect(active()).toBe("b");
    act(() => void jest.advanceTimersByTime(1000));
    expect(active()).toBe("c");
    act(() => void jest.advanceTimersByTime(1000));
    expect(active()).toBe("a");
  });

  it("a new segment rewinds to the first slide and starts a fresh lazy deck", () => {
    const { rerender } = render(<SlideDeck slides={slides} holdMs={1000} resetKey="seg-1" />);
    act(() => void jest.advanceTimersByTime(1000));
    act(() => void jest.advanceTimersByTime(1000)); // everything mounted, c on air
    expect(active()).toBe("c");
    const next: DeckSlide[] = [...slides, { id: "d", node: <div>slide-d</div> }];
    rerender(<SlideDeck slides={next} holdMs={1000} resetKey="seg-2" />);
    expect(active()).toBe("a");
    expect(mounted("b")).toBe(true); // up next
    expect(mounted("c")).toBe(false); // aired for the previous segment — not carried over
    expect(screen.queryByText("slide-d")).not.toBeInTheDocument();
  });
});
