import type { CamSource } from "@photonsurge/shared/cams/types";
import { windySource } from "./windy";
import { tflSource } from "./tfl";
import { nationalHighwaysSource } from "./nationalHighways";

/**
 * The camera source registry (mirrors the alerts registry). The worker
 * registers one repeatable `cams.ingest` job per ENABLED source, keyed on its
 * `pollIntervalSec` (see index.ts). A source disables itself when its
 * prerequisites are missing — Windy needs WINDY_WEBCAMS_API_KEY; National
 * Highways needs a subscription key + CAMS_NH_ENABLED=true. TfL is free/keyless
 * and on by default.
 */
export const CAM_SOURCES: CamSource[] = [windySource, tflSource, nationalHighwaysSource];

export const getEnabledCamSources = (): CamSource[] => CAM_SOURCES.filter((s) => s.enabled);

export const getCamSource = (id: string): CamSource | undefined =>
  CAM_SOURCES.find((s) => s.id === id);
