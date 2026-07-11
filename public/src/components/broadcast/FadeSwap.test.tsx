import { render } from "@testing-library/react";
import FadeSwap from "./FadeSwap";

describe("FadeSwap", () => {
  it("shows the live children and is opaque when not hidden", () => {
    const { container, getByText } = render(<FadeSwap hidden={false}>A</FadeSwap>);
    expect(getByText("A")).toBeInTheDocument();
    expect((container.firstChild as HTMLElement).style.opacity).toBe("1");
  });

  it("freezes the previous content (not the new children) while hidden, then fades out", () => {
    const { container, rerender, getByText, queryByText } = render(
      <FadeSwap hidden={false}>A</FadeSwap>,
    );
    // Cut: hidden flips true AND children swap to the next card in the same commit.
    rerender(<FadeSwap hidden={true}>B</FadeSwap>);
    // Still showing the OLD content (A), fading out — not B snapping in.
    expect(getByText("A")).toBeInTheDocument();
    expect(queryByText("B")).not.toBeInTheDocument();
    expect((container.firstChild as HTMLElement).style.opacity).toBe("0");
  });

  it("reveals the latest content and fades back in when un-hidden", () => {
    const { container, rerender, getByText, queryByText } = render(
      <FadeSwap hidden={false}>A</FadeSwap>,
    );
    rerender(<FadeSwap hidden={true}>B</FadeSwap>);
    rerender(<FadeSwap hidden={false}>B</FadeSwap>);
    expect(getByText("B")).toBeInTheDocument();
    expect(queryByText("A")).not.toBeInTheDocument();
    expect((container.firstChild as HTMLElement).style.opacity).toBe("1");
  });
});
