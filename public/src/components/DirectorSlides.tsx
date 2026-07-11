"use client";

/**
 * "Look per shot type" — a saved-slide library per kind. Save/Update snapshot
 * the live map (basemap, satellite, wind, this kind's overlay toggles) into a
 * named slide; clicking a slide loads it via that kind's
 * kindLooks/overlayOverrides, and pushes it onto the live map immediately so
 * an idle operator sees the change without waiting for the director to cut to
 * this kind.
 */
import { useState } from "react";
import { SEGMENT_KINDS, type KindSlide, type SegmentKind } from "@photonsurge/shared/director";
import { mergeControlState, type ControlState } from "@photonsurge/shared/control";
import type { DirectorConfig } from "@photonsurge/shared/director";
import { slideFromLive, controlPatchFromSlide, slideIsLive } from "../lib/director-slides";
import { box } from "./panelBox";
import { KIND_LABEL } from "./DirectorHolds";
import InfoTip from "./InfoTip";

export default function DirectorSlides({
  config,
  update,
  liveState,
  applyLive,
}: {
  config: DirectorConfig;
  update: (patch: Partial<DirectorConfig>) => void;
  liveState: ControlState;
  applyLive: (next: ControlState) => void;
}) {
  // Brief "Updated ✓" flash per kind after hitting Update — otherwise the
  // action is silent and looks like it did nothing.
  const [justUpdated, setJustUpdated] = useState<Partial<Record<SegmentKind, boolean>>>({});
  const flashUpdated = (kind: SegmentKind) => {
    setJustUpdated((prev) => ({ ...prev, [kind]: true }));
    setTimeout(() => setJustUpdated((prev) => ({ ...prev, [kind]: false })), 1500);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6, display: "flex", alignItems: "center" }}>
        Look per shot type:
        <InfoTip text="Save the live map's basemap/wind/satellite/overlay look as a named slide per shot type, then switch between saved looks any time. Clicking a slide also pushes it onto the live map now." />
      </div>
      {SEGMENT_KINDS.filter((k) => config.kinds[k]).map((kind) => {
        const slides = config.kindSlides[kind] ?? [];
        const activeId = config.activeSlideId[kind];
        const load = (id: string) => {
          const slide = slides.find((s) => s.id === id);
          update({
            kindLooks: { ...config.kindLooks, [kind]: slide ? { ...slide.look } : {} },
            overlayOverrides: { ...config.overlayOverrides, [kind]: slide ? { ...slide.overlays } : {} },
            activeSlideId: { ...config.activeSlideId, [kind]: id },
          });
          if (slide) applyLive(mergeControlState(liveState, controlPatchFromSlide(slide, liveState)));
        };
        const saveNew = () => {
          const name = window.prompt("Name this slide:");
          if (!name) return;
          const snapshot = slideFromLive(liveState);
          const newSlide: KindSlide = { id: crypto.randomUUID(), name, ...snapshot };
          update({
            kindSlides: { ...config.kindSlides, [kind]: [...slides, newSlide] },
            kindLooks: { ...config.kindLooks, [kind]: newSlide.look },
            overlayOverrides: { ...config.overlayOverrides, [kind]: newSlide.overlays },
            activeSlideId: { ...config.activeSlideId, [kind]: newSlide.id },
          });
        };
        const updateSelected = () => {
          if (!activeId) return;
          const snapshot = slideFromLive(liveState);
          update({
            kindSlides: {
              ...config.kindSlides,
              [kind]: slides.map((s) => (s.id === activeId ? { ...s, ...snapshot } : s)),
            },
            kindLooks: { ...config.kindLooks, [kind]: snapshot.look },
            overlayOverrides: { ...config.overlayOverrides, [kind]: snapshot.overlays },
          });
          flashUpdated(kind);
        };
        const renameSlide = (id: string) => {
          const current = slides.find((s) => s.id === id);
          const name = window.prompt("Rename this slide:", current?.name ?? "");
          if (!name) return;
          update({
            kindSlides: { ...config.kindSlides, [kind]: slides.map((s) => (s.id === id ? { ...s, name } : s)) },
          });
        };
        const deleteSlide = (id: string) => {
          if (!window.confirm("Delete this slide?")) return;
          update({
            kindSlides: { ...config.kindSlides, [kind]: slides.filter((s) => s.id !== id) },
            activeSlideId: activeId === id ? { ...config.activeSlideId, [kind]: null } : config.activeSlideId,
          });
        };
        const copyTo = (slide: KindSlide, target: SegmentKind) => {
          const copy: KindSlide = { ...slide, id: crypto.randomUUID() };
          update({
            kindSlides: { ...config.kindSlides, [target]: [...(config.kindSlides[target] ?? []), copy] },
          });
        };
        return (
          <div key={kind} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #1b2030" }}>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>{KIND_LABEL[kind]}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {slides.length === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.5 }}>No saved slides yet</div>
              ) : (
                slides.map((s) => {
                  const selected = s.id === activeId;
                  // Only glow green when the live map still exactly matches this
                  // slide — selecting it (or another kind's slide) can drift the
                  // shared live map away without clearing the stale id.
                  const isLive = selected && slideIsLive(s, liveState);
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => load(s.id)}
                        style={{
                          ...box,
                          flex: 1,
                          textAlign: "left",
                          cursor: "pointer",
                          background: isLive ? "#1f7a3f" : box.background,
                          borderColor: isLive ? "#2bbe63" : selected ? "#3a7bd5" : "#2a3344",
                        }}
                      >
                        {s.name}
                        {selected && !isLive ? <span style={{ opacity: 0.6, fontSize: 11 }}> (modified)</span> : null}
                      </button>
                      {selected ? (
                        <button
                          type="button"
                          onClick={updateSelected}
                          style={{ ...box, cursor: "pointer", padding: "3px 8px" }}
                          title="Overwrite this slide with the current live map"
                        >
                          {justUpdated[kind] ? "✓ Updated" : "⟳ Update"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => renameSlide(s.id)}
                        style={{ ...box, cursor: "pointer", padding: "3px 8px" }}
                        title="Rename this slide"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSlide(s.id)}
                        style={{ ...box, cursor: "pointer", padding: "3px 8px", color: "#ff6a6a" }}
                        title="Delete this slide"
                      >
                        ✕
                      </button>
                      <select
                        value=""
                        onChange={(e) => {
                          const target = e.target.value as SegmentKind;
                          if (target) copyTo(s, target);
                        }}
                        style={{ ...box, padding: "3px 4px", fontSize: 12 }}
                        title="Copy this slide to another shot type"
                      >
                        <option value="">⧉ Copy to…</option>
                        {SEGMENT_KINDS.filter((k) => k !== kind && config.kinds[k]).map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })
              )}
              <button
                type="button"
                onClick={saveNew}
                style={{ ...box, cursor: "pointer", alignSelf: "flex-start" }}
                title="Save the current live map as a new slide for this shot type"
              >
                + Save current look as new slide
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
