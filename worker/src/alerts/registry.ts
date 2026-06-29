import type { AlertSource } from "@photonsurge/shared/alerts/types";
import { nwsSource } from "./nws";
import { meteoalarmSource } from "./meteoalarm";
import { wmoSource } from "./wmo";
import { gdacsSource } from "./gdacs";

/**
 * The source registry (spec §6). One BullMQ repeatable job is registered per
 * enabled source, keyed on its `pollIntervalSec`.
 *
 * WMO SWIC is a global superset — it already carries the US (NWS) and Europe
 * (MeteoAlarm) warnings — so the default is WMO as the single warnings source
 * plus GDACS for big-disaster point markers. One source per event = no
 * cross-source duplicates. Set ALERTS_REGIONAL=true to ALSO run the richer,
 * dedicated NWS + MeteoAlarm adapters; pair that with WMO_EXCLUDE_CC=us,at,be,…
 * so WMO fills only the regions they don't cover (otherwise US/EU double up).
 */
const regional: AlertSource[] =
  process.env.ALERTS_REGIONAL === "true" ? [nwsSource, meteoalarmSource] : [];

export const ALERT_SOURCES: AlertSource[] = [wmoSource, gdacsSource, ...regional];

export const getEnabledSources = (): AlertSource[] => ALERT_SOURCES.filter((s) => s.enabled);

export const getSource = (id: string): AlertSource | undefined =>
  ALERT_SOURCES.find((s) => s.id === id);
