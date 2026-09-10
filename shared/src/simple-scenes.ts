/**
 * The three "simple" broadcast scenes for multi-view constant streaming — each a
 * self-running, single-look spinning globe (director stays OFF; the look never
 * changes) meant to sit live on YouTube 24/7 next to the main operator show.
 *
 * Pure catalog data: `worker/src/scripts/seedSimpleScenes.ts` upserts these as
 * scenes + one (disabled) StreamSlot each; going live is then just registering
 * an OBS encoder per scene and flipping the slot switch on /admin/streams.
 */
import type { ControlState } from "./control";

export interface SimpleScenePreset {
  /** Scene id → /watch/<id>, and the browser-source URL an encoder captures. */
  id: string;
  /** Scene name shown in pickers ("Simple ·" prefix groups them together). */
  name: string;
  /** The persistent StreamSlot seeded for this scene (created disabled). */
  slotId: string;
  slotName: string;
  /** YouTube broadcast title the slot uses. */
  title: string;
  seed: Partial<ControlState>;
}

/** Shared ambience: a slow spin, city labels, broadcast chrome, music bed on. */
const AMBIENT: Partial<ControlState> = {
  autoSpin: true,
  spinSpeed: 4, // gentler than the operator default — this loops for hours
  showCities: true,
  showBroadcastChrome: true,
  showAtmosphere: true,
  audio: { enabled: true, mode: "auto", volume: 0.7, muted: false },
};

export const SIMPLE_SCENE_PRESETS: SimpleScenePreset[] = [
  {
    id: "simple-temp",
    name: "Simple · Temperature",
    slotId: "slot-simple-temp",
    slotName: "Temperature 24/7",
    title: "World Temperature Live — Spinning Weather Globe 24/7",
    seed: {
      ...AMBIENT,
      activeVariable: "temp",
      basemap: "dark",
      showWind: false, // temperature IS the shot — keep the field unobstructed
    },
  },
  {
    id: "simple-wind",
    name: "Simple · Wind",
    slotId: "slot-simple-wind",
    slotName: "Wind 24/7",
    title: "World Wind Live — Global Wind & Pressure Map 24/7",
    seed: {
      ...AMBIENT,
      activeVariable: null, // particles over plain dark; no scalar wash behind them
      basemap: "dark",
      showWind: true,
      showPressure: true, // isobars + H/L give the flow its context
    },
  },
  {
    id: "simple-clouds",
    name: "Simple · Clouds",
    slotId: "slot-simple-clouds",
    slotName: "Clouds 24/7",
    title: "Earth From Space Live — Clouds & City Lights 24/7",
    seed: {
      ...AMBIENT,
      activeVariable: null,
      basemap: "satellite",
      showWind: false,
      showSatImg: true, // global cloud mosaic (default feed state has it on)
      showDayNight: true, // real terminator + night lights over imagery
    },
  },
];
