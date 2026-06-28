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
