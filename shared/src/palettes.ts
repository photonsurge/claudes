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
  // Ocean current speed (|v|), viridis-like: slow indigo → fast yellow. Colours
  // the current particle/arrow layer by magnitude over 0..3 m/s.
  current: [
    [0.0, "#3b1f6b"],
    [0.25, "#3457a8"],
    [0.5, "#1f9bb0"],
    [0.7, "#2fbf6f"],
    [0.85, "#a8d84a"],
    [1.0, "#f2e23a"],
  ],
  // Sea surface salinity: fresher green → saltier deep blue/violet, an
  // oceanographic ramp over ~30..40 PSU.
  salinity: [
    [0.0, "#1f6f4a"],
    [0.3, "#2f9bd6"],
    [0.55, "#3257b0"],
    [0.8, "#3b2f8f"],
    [1.0, "#6a1f7a"],
  ],
  // Wind particle speed colouring.
  wind: [
    [0.0, "#e8f0ff"],
    [0.4, "#7fd0e0"],
    [0.7, "#f2e23a"],
    [0.9, "#f2802e"],
    [1.0, "#df2727"],
  ],
  // Hypsometric relief over the elevation domain (−11,000..9,000 m). Sea level is
  // ≈0.55 of the ramp; a sharp cyan→green step there marks the coastline. Many
  // stops so the colours SPREAD across depth (abyss → shelf) and height (lowland →
  // peak) instead of bunching in the common mid-range. Used by the Relief basemap.
  elevation: [
    [0.0, "#050436"],
    [0.14, "#0b1a70"],
    [0.28, "#15479e"],
    [0.4, "#2f7dc6"],
    [0.49, "#5fb3df"],
    [0.545, "#a6e3f0"],
    [0.55, "#2e8b57"],
    [0.61, "#77c25a"],
    [0.67, "#c6de83"],
    [0.73, "#e6c877"],
    [0.8, "#cd8f4c"],
    [0.88, "#9c5a37"],
    [0.94, "#b294a6"],
    [1.0, "#ffffff"],
  ],
  // Elevation CONTOUR LINES coloured by height — a brighter, well-spread variant
  // of the relief ramp so thin strokes read on a dark globe (the relief palette's
  // deep blues vanish as lines). Same 14-stop spread; cool blues below sea level →
  // green at the coast (≈0.55) → warm tans/browns → white peaks.
  elevation_line: [
    [0.0, "#6f8cff"],
    [0.14, "#5fa8ff"],
    [0.28, "#4fc6ff"],
    [0.4, "#7fe0ff"],
    [0.49, "#b8f2ff"],
    [0.545, "#dbffff"],
    [0.55, "#7dffb0"],
    [0.61, "#b6f08a"],
    [0.67, "#e0f086"],
    [0.73, "#f5dd7a"],
    [0.8, "#f5b96a"],
    [0.88, "#f09a72"],
    [0.94, "#f0c0d0"],
    [1.0, "#ffffff"],
  ],
  // Aurora oval (OVATION probability). Green low-activity → yellow → red at the
  // energetic core, mirroring how auroras brighten green→red with intensity. The
  // sub-floor probability bakes transparent (nodata mask), like radar's clear-air
  // floor, so only the oval glows over the poles.
  aurora: [
    [0.0, "#1ef07a"],
    [0.35, "#7bf05a"],
    [0.6, "#e6f23a"],
    [0.8, "#f2802e"],
    [1.0, "#ff2e5a"],
  ],
  // Radar reflectivity (dBZ), NWS-style over the 5..75 dBZ domain: light drizzle
  // teal/green → moderate rain yellow → heavy orange/red → hail magenta/white.
  // The <5 dBZ floor bakes transparent (minVisible) so clear air shows the map.
  radar: [
    [0.0, "#04e9e7"],
    [0.2, "#019ff4"],
    [0.3, "#02fd02"],
    [0.45, "#fdf802"],
    [0.6, "#fd9500"],
    [0.72, "#fd0000"],
    [0.85, "#f800fd"],
    [1.0, "#ffffff"],
  ],
};

export const getPalette = (id: string): Palette => PALETTES[id] ?? PALETTES.temp;
