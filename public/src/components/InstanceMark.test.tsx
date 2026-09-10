/**
 * The badge that tells the operator which box they're on.
 *
 * Two things matter and neither is visible in a diff: it must render nothing at
 * all when the chrome is off (so the surfaces keep their designed colours), and
 * it must never eat a click — it sits fixed over an operator console that has
 * live controls under every corner.
 */
import { render, screen } from "@testing-library/react";
import InstanceMark, { InstanceSurface } from "./InstanceMark";
import { INSTANCE_COLOR, type Instance } from "../lib/instance";

const TEST: Instance = { id: "test", label: "TEST", color: INSTANCE_COLOR.test };

describe("InstanceMark", () => {
  it("names the deployment", () => {
    render(<InstanceMark instance={TEST} />);

    expect(screen.getByText("TEST")).toBeInTheDocument();
  });

  it("renders nothing when the chrome is off", () => {
    const { container } = render(<InstanceMark instance={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("wears the instance colour", () => {
    const { container } = render(<InstanceMark instance={TEST} />);

    const strip = container.firstElementChild as HTMLElement;
    expect(strip).toHaveStyle({ background: INSTANCE_COLOR.test, position: "fixed" });
  });

  it("can't take a click off a control underneath it", () => {
    const { container } = render(<InstanceMark instance={TEST} />);

    for (const el of Array.from(container.children) as HTMLElement[]) {
      expect(el).toHaveStyle({ pointerEvents: "none" });
    }
  });

  it("moves out of the way when a page already owns its corners", () => {
    // /control keeps its legend top-left and its reports top-right.
    const { container } = render(<InstanceMark instance={TEST} align="center" />);

    const label = container.children[1] as HTMLElement;
    expect(label).toHaveStyle({ left: "50%" });
    expect(label.style.right).toBe("");
  });

  describe("InstanceSurface", () => {
    it("hands the page its tint without adding a box", () => {
      // /control's <main> is a 100vh flex row — a wrapper with a box of its own
      // would change the layout it sits in.
      const { container } = render(
        <InstanceSurface instance={TEST}>
          <main data-testid="page" />
        </InstanceSurface>,
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.display).toBe("contents");
      expect(wrapper.style.getPropertyValue("--inst-page")).toMatch(/^#[0-9a-f]{6}$/);
      expect(screen.getByTestId("page")).toBeInTheDocument();
    });

    it("sets no variables when the chrome is off, so the page keeps its own colours", () => {
      const { container } = render(
        <InstanceSurface instance={null}>
          <main data-testid="page" />
        </InstanceSurface>,
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.getPropertyValue("--inst-page")).toBe("");
      expect(screen.queryByText("TEST")).not.toBeInTheDocument();
    });
  });
});
