"use client";

/**
 * The body of a settings page: the group rail, the selected group's cards and
 * the Save bar — rendered inside a `SceneDraftProvider`, so the rail can count
 * what is staged in each group. Which groups and cards exist comes from the
 * page's catalog (`SettingsCatalogContext`); the page maps card ids to
 * components. Shared by the channel page (/admin/scenes/:id) and a short
 * format's editor (/admin/shorts/formats/:id), which adds a docked `aside`.
 *
 * `?s=<group>` selects a group and `#<card>` deep-links to one.
 */
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { cardsInGroup, groupOfCard, type SettingsGroupId } from "./catalog";
import { useSettingsCatalog } from "./catalog-context";
import { useSceneDraft } from "./SceneDraft";
import SceneSaveBar from "./SceneSaveBar";
import SettingsGroupRail from "./SettingsGroupRail";

export default function SettingsBody({
  components,
  defaultGroup,
  aside,
  loadingLabel = "Loading channel",
}: {
  /** Card id → component. */
  components: Record<string, ComponentType>;
  defaultGroup: SettingsGroupId;
  /** Docked beside the cards on wide screens (the format editor's preview). */
  aside?: ReactNode;
  loadingLabel?: string;
}) {
  const { ready, loadError } = useSceneDraft();
  const { groups, cards } = useSettingsCatalog();
  const [group, setGroup] = useState<SettingsGroupId>(defaultGroup);
  const [anchor, setAnchor] = useState<string | null>(null);

  // Adopt the URL once: `#card` wins over `?s=group`, since a deep link names a
  // card and the group it lives in is implied.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const fromHash = hash ? groupOfCard(hash, cards) : undefined;
    const fromQuery = new URLSearchParams(window.location.search).get("s");
    if (fromHash) {
      setGroup(fromHash);
      setAnchor(hash);
    } else if (fromQuery && groups.some((g) => g.id === fromQuery)) {
      setGroup(fromQuery as SettingsGroupId);
    }
  }, [cards, groups]);

  // Scroll a deep-linked card into view once its group has actually rendered.
  useEffect(() => {
    if (!anchor || !ready) return;
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setAnchor(null);
  }, [anchor, ready, group]);

  // replaceState, not the router: switching group is a view change, not a
  // navigation, and a history entry per click would make Back useless.
  const select = useCallback((id: SettingsGroupId) => {
    setGroup(id);
    const url = new URL(window.location.href);
    url.searchParams.set("s", id);
    url.hash = "";
    window.history.replaceState(null, "", url);
  }, []);

  const def = groups.find((g) => g.id === group) ?? groups[0];

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} sx={{ alignItems: "flex-start" }}>
      <SettingsGroupRail active={def.id} onSelect={select} />

      <Box sx={{ flex: 1, minWidth: 0, maxWidth: 760 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {def.blurb}
        </Typography>

        {loadError ? (
          <Alert severity="error">{loadError}</Alert>
        ) : !ready ? (
          <Stack spacing={2} aria-label={loadingLabel}>
            <Skeleton variant="rounded" height={180} />
            <Skeleton variant="rounded" height={140} />
          </Stack>
        ) : (
          <Stack spacing={2}>
            {cardsInGroup(def.id, cards).map((card) => {
              const Card = components[card.id];
              return Card ? <Card key={card.id} /> : null;
            })}
          </Stack>
        )}

        <SceneSaveBar />
      </Box>

      {aside ? (
        <Box
          component="aside"
          sx={{ width: { xs: "100%", md: 520, xl: 640 }, flexShrink: 0, position: { md: "sticky" }, top: 16, alignSelf: "flex-start" }}
        >
          {aside}
        </Box>
      ) : null}
    </Stack>
  );
}
