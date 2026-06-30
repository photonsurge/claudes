/**
 * Colour ramps per variable. A palette is a list of `[stop, hexColor]` where
 * `stop` is normalised 0..1 across the variable's domain. The web renderer maps
 * these into WeatherLayers colour ramps; the worker never colours pixels (scalar
 * textures stay as raw Float32 and are ramped on the GPU).
 */
export type PaletteStop = [number, string];
export type Palette = PaletteStop[];

export const PALETTES: Record<string, Palette> = {
  // Cold blue → warm red, broadcast-style temperature ramp.
  temp: [
    [0.0, "#3b1f6b"],
    [0.15, "#3257b0"],
    [0.3, "#2f9bd6"],
    [0.45, "#48c9a9"],
    [0.55, "#8fd86a"],
    [0.65, "#f2e23a"],
    [0.78, "#f29b2e"],
    [0.9, "#df4327"],
    [1.0, "#7a1414"],
  ],
  // Dry brown → humid green/blue.
  humidity: [
    [0.0, "#6b4a2b"],
    [0.3, "#b08a4c"],
    [0.5, "#d9d36a"],
    [0.7, "#5bb86a"],
    [0.85, "#2f9bd6"],
    [1.0, "#1f3f9b"],
  ],
  // Light → heavy precipitation.
  rain: [
    [0.0, "#0a1a2f"],
    [0.2, "#1f6fb0"],
    [0.45, "#3ec46a"],
    [0.65, "#f2e23a"],
    [0.82, "#f2802e"],
    [1.0, "#c01f7a"],
  ],
  // Convective risk (CAPE).
  storm: [
    [0.0, "#10240f"],
    [0.3, "#2f8f3a"],
    [0.55, "#f2e23a"],
    [0.75, "#f2802e"],
    [0.9, "#df2727"],
    [1.0, "#7a0f5a"],
  ],
  // Gust speed.
  gust: [
    [0.0, "#0a2f2a"],
    [0.3, "#2f9bd6"],
    [0.55, "#8fd86a"],
    [0.75, "#f2e23a"],
    [0.9, "#f2802e"],
    [1.0, "#df2727"],
  ],
  // MSLP: diverging over domain 950..1050 hPa. Deep lows purple/blue, standard
  // pressure (~1013, ≈0.63) near-neutral, highs warm yellow→red. Reads as
  // "storms vs. ridges" at a glance on a broadcast globe.
  pressure: [
    [0.0, "#6a3d9a"],
    [0.3, "#3257b0"],
    [0.5, "#52b0d6"],
    [0.63, "#e8eef2"],
    [0.75, "#f2c14e"],
    [0.9, "#e8772e"],
    [1.0, "#b81d1d"],
  ],
  // Sea surface temp: deep cold near-black-blue → cyan → warm tropical red.
  // Tuned for the SST domain (−2..32 °C), oceanographic look.
  sst: [
    [0.0, "#08123b"],
    [0.18, "#1f4fa0"],
    [0.38, "#2f9bd6"],
    [0.55, "#48c9a9"],
    [0.7, "#cfe05a"],
    [0.85, "#f29b2e"],
    [1.0, "#c0181f"],
  ],
  // Cloud cover: thin grey wisp → opaque white overcast (clouds read as cloud).
  cloud: [
    [0.0, "#9aa6b2"],
    [0.4, "#c8d2db"],
    [0.7, "#e8eef2"],
    [1.0, "#ffffff"],
  ],
  // Snow depth: pale blue dusting → deep snowpack white/cyan.
  snow: [
    [0.0, "#bfe3ff"],
    [0.35, "#8fc7f0"],
    [0.7, "#dfeefc"],
    [1.0, "#ffffff"],
  ],
  // Significant wave height: calm teal → building blue → dangerous magenta/red.
  wave_height: [
    [0.0, "#0a3340"],
    [0.25, "#0f7a8a"],
    [0.5, "#2f9bd6"],
    [0.7, "#7a6fe0"],
    [0.85, "#c84fb0"],
    [1.0, "#e02747"],
  ],
  // Wind particle speed colouring.
  wind: [
    [0.0, "#e8f0ff"],
    [0.4, "#7fd0e0"],
    [0.7, "#f2e23a"],
    [0.9, "#f2802e"],
    [1.0, "#df2727"],
  ],
};

export const getPalette = (id: string): Palette => PALETTES[id] ?? PALETTES.temp;
