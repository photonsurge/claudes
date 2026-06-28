import { render, screen, fireEvent } from "@testing-library/react";
import VariablePicker from "./VariablePicker";
import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";

describe("VariablePicker", () => {
  it("renders a None button plus each scalar variable", () => {
    render(<VariablePicker value="temp" onChange={() => {}} />);
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText(VARIABLE_REGISTRY.temp.label)).toBeInTheDocument();
  });

  it("calls onChange with the picked id and null for None", () => {
    const onChange = jest.fn();
    render(<VariablePicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText(VARIABLE_REGISTRY.humidity.label));
    expect(onChange).toHaveBeenCalledWith("humidity");
    fireEvent.click(screen.getByText("None"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("marks the active variable pressed", () => {
    render(<VariablePicker value="temp" onChange={() => {}} />);
    const btn = screen.getByText(VARIABLE_REGISTRY.temp.label);
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });
});
