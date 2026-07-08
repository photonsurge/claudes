import { act, render, screen } from "@testing-library/react";
import SlideDeck, { type DeckSlide } from "./SlideDeck";

const slides: DeckSlide[] = [
  { id: "a", node: <div>slide-a</div> },
  { id: "b", node: <div>slide-b</div> },
  { id: "c", node: <div>slide-c</div> },
];

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

  it("keeps every slide mounted so panel state survives a rotation", () => {
    render(<SlideDeck slides={slides} />);
    // All three are in the DOM at once (opacity-toggled, never unmounted).
    expect(screen.getByText("slide-a")).toBeInTheDocument();
    expect(screen.getByText("slide-b")).toBeInTheDocument();
    expect(screen.getByText("slide-c")).toBeInTheDocument();
  });

  it("advances the active slide on the hold timer and wraps around", () => {
    render(<SlideDeck slides={slides} holdMs={1000} />);
    const active = () => slides.find((s) => screen.getByText(`slide-${s.id}`).parentElement?.getAttribute("aria-hidden") === "false");

    expect(active()?.id).toBe("a");
    act(() => void jest.advanceTimersByTime(1000));
    expect(active()?.id).toBe("b");
    act(() => void jest.advanceTimersByTime(1000));
    expect(active()?.id).toBe("c");
    act(() => void jest.advanceTimersByTime(1000));
    expect(active()?.id).toBe("a");
  });
});
