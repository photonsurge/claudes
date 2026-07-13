import { fireEvent, render, screen } from "@testing-library/react";
import ImageLightbox from "./ImageLightbox";

describe("ImageLightbox", () => {
  it("fills the viewport and closes with Escape or the close button", () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <ImageLightbox image={{ src: "/snapshot.png", alt: "satellite", caption: "Latest pass" }} onClose={onClose} />,
    );

    expect(screen.getByRole("dialog", { name: "Image preview" })).toHaveStyle({ position: "fixed", inset: "0" });
    expect(screen.getByRole("img", { name: "satellite" })).toHaveAttribute("src", "/snapshot.png");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<ImageLightbox image={{ src: "/snapshot.png", alt: "satellite" }} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the backdrop but not when the image is clicked", () => {
    const onClose = jest.fn();
    render(<ImageLightbox image={{ src: "/snapshot.png", alt: "compare" }} onClose={onClose} />);

    fireEvent.click(screen.getByRole("img", { name: "compare" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog", { name: "Image preview" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
