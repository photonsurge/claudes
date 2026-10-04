"use client";

/**
 * Which settings map the current page uses. The channel page needs nothing —
 * the default is the channel catalog — while a short format's editor provides
 * its own card list (docs/short-video-plan.md §5.5: "its own card list,
 * separate from the channel page's"). The shared pieces that name cards — the
 * card shell, the group rail and the Save bar — read it from here, so one card
 * component renders under either page with that page's title and grouping.
 */
import { createContext, useContext } from "react";
import { CHANNEL_CATALOG, type SettingsCatalog } from "./catalog";

export const SettingsCatalogContext = createContext<SettingsCatalog>(CHANNEL_CATALOG);

export const useSettingsCatalog = (): SettingsCatalog => useContext(SettingsCatalogContext);
