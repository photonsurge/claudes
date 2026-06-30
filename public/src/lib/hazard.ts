/**
 * Hazard vocabulary now lives in `shared` so the worker's auto-director can use
 * the same classification + colour/icon table the public overlays do. Re-exported
 * here so existing `../lib/hazard` imports keep working unchanged.
 */
export * from "@photonsurge/shared/alerts/hazard";
