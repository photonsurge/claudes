/**
 * YouTube video card (§6.8): the token picker adds codes, the title preview
 * resolves against the format's most recent script's values (or the examples
 * when there is none), shows the trimmed title and its length, and a time zone
 * is staged only once Intl knows it.
 */
import { fireEvent, screen } from "@testing-library/react";
import { defaultShortFormat, type ShortFormat } from "@photonsurge/shared/short-format";
import type { ShortScript } from "@photonsurge/shared/short-script";
import { renderInDraft } from "../../scenes/draft-harness";
import { SettingsCatalogContext } from "../../scenes/catalog-context";
import FormatVideoSettings from "./FormatVideoSettings";
import { FormatScriptContext } from "./format-script";
import { FORMAT_CATALOG } from "./format-catalog";

const format = (over: Partial<ShortFormat["video"]> = {}): ShortFormat => {
  const f = defaultShortFormat("short-eu", "Europe round-up");
  return { ...f, video: { ...f.video, ...over } };
};

const script = (values?: Record<string, string>) =>
  ({
    id: "s1",
    formatId: "short-eu",
    template: "lineup",
    scope: { type: "area", id: "europe" },
    include: { alerts: false, quakes: false, volcanoes: false },
    title: "Europe · Tuesday",
    clips: [],
    status: "draft",
    ...(values ? { values } : {}),
  }) as ShortScript;

function renderCard(f: ShortFormat, s: ShortScript | null = null) {
  return renderInDraft(
    <SettingsCatalogContext.Provider value={FORMAT_CATALOG}>
      <FormatScriptContext.Provider value={s}>
        <FormatVideoSettings />
      </FormatScriptContext.Provider>
    </SettingsCatalogContext.Provider>,
    { sceneId: "short-eu", format: f },
  );
}

beforeEach(() => {
  // 13:05 UTC on Tuesday 8 September 2026 = 14:05 London.
  jest.useFakeTimers().setSystemTime(new Date("2026-09-08T13:05:00Z"));
});
afterEach(() => jest.useRealTimers());

it("is titled from the format catalog", () => {
  renderCard(format());
  expect(screen.getByText("YouTube video")).toBeInTheDocument();
});

it("previews the title against the most recent script's values", () => {
  renderCard(format({ title: "%{place} round-up · %A %e %B" }), script({ place: "Northern Europe" }));
  expect(screen.getByTestId("video-title-preview")).toHaveTextContent("Northern Europe round-up · Tuesday 8 September");
  expect(screen.getByTestId("video-title-length")).toHaveTextContent("46 / 100 characters");
  expect(screen.getAllByText(/the values of “Europe · Tuesday”/).length).toBeGreaterThan(0);
});

it("falls back to the example values when the script has none, and says so", () => {
  renderCard(format({ title: "%{place} · %{format}" }), script());
  expect(screen.getByTestId("video-title-preview")).toHaveTextContent("United Kingdom · Europe round-up");
  expect(screen.getAllByText(/has no stamped values yet/).length).toBeGreaterThan(0);
});

it("falls back to the example values with no script at all", () => {
  renderCard(format({ title: "%{flag} %{place}" }));
  expect(screen.getByTestId("video-title-preview")).toHaveTextContent("🇬🇧 United Kingdom");
  expect(screen.getAllByText(/No script in this format yet/).length).toBeGreaterThan(0);
});

it("shows a long title trimmed at a word, with its full length", () => {
  renderCard(format({ title: "%{headline}" }), script({ headline: "storm ".repeat(30).trim() }));
  const preview = screen.getByTestId("video-title-preview").textContent ?? "";
  expect(Array.from(preview).length).toBeLessThanOrEqual(100);
  expect(preview.endsWith("…")).toBe(true);
  expect(screen.getByTestId("video-title-length")).toHaveTextContent(/179 \/ 100 characters — cut at a word/);
});

it("adds a date code and a value code from the two chip groups", () => {
  const h = renderCard(format({ title: "Round-up " }));
  fireEvent.click(screen.getAllByText("%A · Weekday (Tuesday)")[0]);
  expect(h.lastFormat().video?.title).toBe("Round-up %A");
  fireEvent.click(screen.getAllByText("%{place} · Place name (or the list) (United Kingdom)")[0]);
  expect(h.lastFormat().video?.title).toBe("Round-up %A%{place}");
});

it("previews the date codes in another zone", () => {
  renderCard(format({ title: "%H:%M", timezone: "Australia/Sydney" }));
  expect(screen.getByTestId("video-title-preview")).toHaveTextContent("23:05");
});

it("stages a typed time zone only once it is valid", () => {
  const h = renderCard(format());
  fireEvent.click(screen.getByLabelText("Another zone"));
  const input = screen.getByLabelText("IANA time zone");
  fireEvent.change(input, { target: { value: "Australia/Syd" } });
  expect(h.stagedFormat.some((p) => p.video?.timezone === "Australia/Syd")).toBe(false);
  expect(screen.getByText(/Not a time zone this browser knows/)).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "Australia/Sydney" } });
  expect(h.lastFormat().video?.timezone).toBe("Australia/Sydney");
});

it("stages the place's own zone", () => {
  const h = renderCard(format());
  fireEvent.click(screen.getByLabelText("The place's own"));
  expect(h.lastFormat().video?.timezone).toBe("place");
});

it("adds tags with Enter or a comma, and removes them", () => {
  const h = renderCard(format({ tags: ["weather"] }));
  const input = screen.getByLabelText("Add tags");
  fireEvent.change(input, { target: { value: "europe" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(h.lastFormat().video?.tags).toEqual(["weather", "europe"]);
  fireEvent.change(input, { target: { value: "storms," } });
  expect(h.lastFormat().video?.tags).toEqual(["weather", "europe", "storms"]);
  fireEvent.click(screen.getAllByTestId("CancelIcon")[0]);
  expect(h.lastFormat().video?.tags).toEqual(["europe", "storms"]);
});

it("a frame thumbnail: pick it, set the second, and back to an image", () => {
  const h = renderCard(format({ thumbnail: { source: "image", url: "/t.png" } }));
  fireEvent.click(screen.getByLabelText("A frame of the video"));
  expect(h.lastFormat().video?.thumbnail).toEqual({ source: "frame", atMs: 5_000 });
  fireEvent.change(screen.getByLabelText("Seconds into the script"), { target: { value: "12.5" } });
  expect(h.lastFormat().video?.thumbnail).toEqual({ source: "frame", atMs: 12_500 });
  expect(screen.queryByLabelText("Image URL or site path")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("An image"));
  expect(h.lastFormat().video?.thumbnail).toEqual({ source: "image", url: "" });
});

it("stages the thumbnail path and shows it resolved", () => {
  const h = renderCard(format({ thumbnail: { source: "image", url: "/thumbs/%{placeId}.png" } }));
  expect(screen.getByText(/Resolves to \/thumbs\/gb.png/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Image URL or site path"), { target: { value: "/t.png" } });
  expect(h.lastFormat().video?.thumbnail).toEqual({ source: "image", url: "/t.png" });
});
