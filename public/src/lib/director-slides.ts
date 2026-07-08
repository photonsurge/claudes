/**
 * Pure helpers behind DirectorSlides' "look per shot type" slide library: a
 * saved slide snapshots the live map's basemap/wind/satellite look plus every
 * toggleable overlay, so loading it later reproduces the whole look exactly —
 * not just the layers that kind's preset happens to default on.
 */
import { OVERLAY_KEYS } from "@photonsurge/shared/director-rois";
import type { KindSlide } from "@photonsurge/shared/director";
import type { ControlState } from "@photonsurge/shared/control";

export function slideFromLive(live: ControlState): Pick<KindSlide, "look" | "overlays"> {
  const overlays: Partial<Record<string, boolean>> = {};
  for (const key of OVERLAY_KEYS) {
    overlays[key] = Boolean((live as unknown as Record<string, boolean>)[key]);
  }
  const satImgFeeds: Record<string, ControlState["satImgFeeds"][string]> = {};
  for (const [id, feed] of Object.entries(live.satImgFeeds ?? {})) satImgFeeds[id] = { ...feed };
  return {
    look: {
      basemap: live.basemap,
      windMode: live.windMode,
      wind: { ...live.wind },
      showSatImg: live.showSatImg,
      activeVariable: live.activeVariable,
      satImgFeeds,
      auroraOpacity: live.auroraOpacity,
      magneticFieldOpacity: live.magneticFieldOpacity,
    },
    overlays,
  };
}

/** The live-map patch a slide would apply — the inverse of slideFromLive. */
export function controlPatchFromSlide(slide: KindSlide, live: ControlState): Partial<ControlState> {
  const patch: Partial<ControlState> = { ...slide.overlays };
  if (slide.look.basemap) patch.basemap = slide.look.basemap;
  if (slide.look.windMode) patch.windMode = slide.look.windMode;
  if (slide.look.wind) patch.wind = { ...live.wind, ...slide.look.wind };
  if (typeof slide.look.showSatImg === "boolean") patch.showSatImg = slide.look.showSatImg;
  if (slide.look.activeVariable) patch.activeVariable = slide.look.activeVariable;
  if (slide.look.satImgFeeds) patch.satImgFeeds = slide.look.satImgFeeds as ControlState["satImgFeeds"];
  if (typeof slide.look.auroraOpacity === "number") patch.auroraOpacity = slide.look.auroraOpacity;
  if (typeof slide.look.magneticFieldOpacity === "number")
    patch.magneticFieldOpacity = slide.look.magneticFieldOpacity;
  return patch;
}

function shallowEqual(a: Record<string, unknown> | undefined | null, b: Record<string, unknown> | undefined | null): boolean {
  const ao = a ?? {};
  const bo = b ?? {};
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if ((ao as Record<string, unknown>)[k] !== (bo as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/** Per-feed satImgFeeds equality — each feed compared field-by-field, not by reference. */
function satImgFeedsEqual(
  a: Partial<Record<string, unknown>> | null | undefined,
  b: Partial<Record<string, unknown>> | null | undefined,
): boolean {
  const ao = a ?? {};
  const bo = b ?? {};
  const ids = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const id of ids) {
    if (!shallowEqual(ao[id] as Record<string, unknown>, bo[id] as Record<string, unknown>)) return false;
  }
  return true;
}

/**
 * Whether a slide's saved look+overlays exactly match the current live
 * snapshot — used so the "active" highlight reflects reality (settings match)
 * rather than a stale remembered id (e.g. after loading a different kind's
 * slide changed the one shared live map, or after hand-tweaking the globe).
 */
export function slideIsLive(slide: KindSlide, live: ControlState): boolean {
  const current = slideFromLive(live);
  return (
    (slide.look.basemap ?? null) === (current.look.basemap ?? null) &&
    (slide.look.windMode ?? null) === (current.look.windMode ?? null) &&
    (slide.look.showSatImg ?? null) === (current.look.showSatImg ?? null) &&
    (slide.look.activeVariable ?? null) === (current.look.activeVariable ?? null) &&
    (slide.look.auroraOpacity ?? null) === (current.look.auroraOpacity ?? null) &&
    (slide.look.magneticFieldOpacity ?? null) === (current.look.magneticFieldOpacity ?? null) &&
    shallowEqual(slide.look.wind, current.look.wind) &&
    satImgFeedsEqual(slide.look.satImgFeeds, current.look.satImgFeeds) &&
    shallowEqual(slide.overlays, current.overlays)
  );
}
