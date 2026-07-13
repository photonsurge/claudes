/** Canonical source ids for volcano-specific monitoring media. */
export const VOLCANO_MEDIA_SOURCES = [
  "GEONET",
  "USGS_VHP",
  "AVO",
  "INGV",
  "PHIVOLCS",
  "IMO",
  "MAGMA",
  "VOLCAT",
  "GVP",
  "WIKIMEDIA",
  "NASA_IMAGES",
  "JMA",
  "CENAPRED",
  "IPGP_OVPF",
] as const;

export type VolcanoMediaSource = (typeof VOLCANO_MEDIA_SOURCES)[number];

export const VOLCANO_MEDIA_TYPES = [
  "WEBCAM",
  "THERMAL",
  "IR",
  "PHOTO",
  "SATELLITE",
  "MAP",
  "GRAPH",
  "TIMELAPSE",
  "VIDEO",
] as const;

export type VolcanoMediaType = (typeof VOLCANO_MEDIA_TYPES)[number];
export type VolcanoCameraMode = "VISIBLE" | "THERMAL" | "IR" | "LOW_LIGHT" | "UNKNOWN";

export interface VolcanoCamera {
  id: string;
  volcanoId: string;
  source: VolcanoMediaSource;
  sourceCameraId: string;
  name: string;
  mode: VolcanoCameraMode;
  latitude?: number;
  longitude?: number;
  bearing?: number;
  currentImageUrl?: string;
  detailUrl: string;
  videoUrl?: string;
  upstreamTimestamp?: string;
  attribution?: string;
  licence?: string;
  reuseAllowed?: boolean;
  enabled: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface VolcanoMedia {
  id: string;
  volcanoId: string;
  source: VolcanoMediaSource;
  type: VolcanoMediaType;
  sourceMediaId?: string;
  cameraId?: string;
  title?: string;
  caption?: string;
  observedAt?: Date;
  publishedAt?: Date;
  acquiredAt: Date;
  imageUrl?: string;
  sourceUrl: string;
  latitude?: number;
  longitude?: number;
  bearing?: number;
  attribution?: string;
  licence?: string;
  reuseAllowed?: boolean;
  contentHash?: string;
  perceptualHash?: string;
  rawPayloadRef?: string;
  /** Blob-store key. Media bytes are never embedded in API metadata. */
  assetRef?: string;
  contentType?: string;
}

export function cameraModeFromText(text: string): VolcanoCameraMode {
  if (/thermal/i.test(text)) return "THERMAL";
  if (/\bIR\b|infrared/i.test(text)) return "IR";
  if (/low[ -]?light/i.test(text)) return "LOW_LIGHT";
  if (/\bvis(?:ible)?\b/i.test(text)) return "VISIBLE";
  return "UNKNOWN";
}
