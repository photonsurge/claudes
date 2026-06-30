import type { AlertSource } from "@photonsurge/shared/alerts/types";
import { nwsSource } from "./nws";
import { meteoalarmSource } from "./meteoalarm";
import { wmoSource } from "./wmo";
import { gdacsSource } from "./gdacs";

/**
 * The source registry (spec §6). One BullMQ repeatable job is registered per
 * enabled source, keyed on its `pollIntervalSec`.
 *
 * WMO SWIC is the global source, but it does NOT carry every national authority
 * — verified against the live feed, it's missing the UK Met Office plus DE, NL,
 * IE, DK and a handful more. MeteoAlarm fills exactly those European gaps; scope
 * it to the WMO-gap countries via METEOALARM_COUNTRIES (see .env) so nothing
 * duplicates. NWS is off by default (WMO carries the US); set ALERTS_NWS_ENABLED
 * =true for its richer US data, then add WMO_EXCLUDE_CC=us so the US doesn't dupe.
 */
const optional: AlertSource[] =
  process.env.ALERTS_NWS_ENABLED === "true" ? [nwsSource] : [];

export const ALERT_SOURCES: AlertSource[] = [wmoSource, gdacsSource, meteoalarmSource, ...optional];

export const getEnabledSources = (): AlertSource[] => ALERT_SOURCES.filter((s) => s.enabled);

export const getSource = (id: string): AlertSource | undefined =>
  ALERT_SOURCES.find((s) => s.id === id);
