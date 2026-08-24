import { render, screen } from "@testing-library/react";
import GodsBanner from "./GodsBanner";

describe("GodsBanner", () => {
  it("keeps the supplied artwork's palette when no scene colours are provided", () => {
    render(<GodsBanner />);
    const banner = screen.getByRole("img", {
      name: "G.O.D.S. Global Orbital Detection System",
    });

    expect(banner.querySelector('[stroke="#20d8ff"]')).toBeInTheDocument();
    expect(banner.querySelector('[stop-color="#68eaff"]')).toBeInTheDocument();
    expect(banner.querySelector('[stop-color="#083a72"]')).toBeInTheDocument();
  });

  it("derives a light and deep logo palette from a scene accent", () => {
    render(<GodsBanner accent="#f43f5e" />);
    const banner = screen.getByRole("img");

    expect(banner.querySelector('[stroke="#f43f5e"]')).toBeInTheDocument();
    expect(banner.querySelector('[stop-color="#f88296"]')).toBeInTheDocument();
    expect(banner.querySelector('[stop-color="#6e1c2a"]')).toBeInTheDocument();
  });

  it("uses unique paint-server ids for multiple banners", () => {
    render(
      <>
        <GodsBanner label="First banner" />
        <GodsBanner label="Second banner" />
      </>,
    );
    const [first, second] = screen.getAllByRole("img");
    const firstGradient = first.querySelector("linearGradient")?.id;
    const secondGradient = second.querySelector("linearGradient")?.id;

    expect(firstGradient).toBeTruthy();
    expect(secondGradient).toBeTruthy();
    expect(firstGradient).not.toBe(secondGradient);
  });
});
