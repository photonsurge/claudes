import type { AlertSource } from "@photonsurge/shared/alerts/types";
import { nwsSource } from "./nws";

/**
 * The source registry (spec §6). Adding a region = add an adapter here. Optional
 * sources (jma/bom) sit behind their own `enabled` flag. One BullMQ repeatable
 * job is registered per enabled source, keyed on its `pollIntervalSec`.
 */
export const ALERT_SOURCES: AlertSource[] = [nwsSource];

export const getEnabledSources = (): AlertSource[] => ALERT_SOURCES.filter((s) => s.enabled);

export const getSource = (id: string): AlertSource | undefined =>
  ALERT_SOURCES.find((s) => s.id === id);
