"use client";

/**
 * Channel-theme context for the broadcast chrome. WatchSurface resolves the
 * theme ONCE (getBroadcastTheme) and provides it here so deeply-nested chrome —
 * CardEyebrow, deck slides, small widgets — can read it without threading a
 * `theme` prop through every layer. Kept separate from config.ts (plain data,
 * imported by admin + tests) because createContext needs a client module.
 */
import { createContext, useContext } from "react";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

/** Resolved channel theme. Null outside a provider (operator console, admin
 *  previews, tests) — consumers fall back to DEFAULT_THEME. */
export const BroadcastThemeContext = createContext<BroadcastTheme | null>(null);

/** Resolution order: explicit prop > provider > DEFAULT_THEME. Existing `theme`
 *  props keep working unchanged; theme-blind components get the channel theme
 *  for free once they call this. */
export function useBroadcastTheme(propTheme?: BroadcastTheme): BroadcastTheme {
  const ctx = useContext(BroadcastThemeContext);
  return propTheme ?? ctx ?? DEFAULT_THEME;
}
