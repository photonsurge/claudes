"use client";

/**
 * The settings page's left rail: one row per group, each showing how many of its
 * cards have unsaved edits. The count is the point — a change staged in a group
 * you are not looking at has to be visible from wherever you are. Only the
 * groups this kind of channel has are listed.
 */
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  cardsForStagedKeys,
  groupsForSurface,
  type SettingsGroupId,
} from "./catalog";
import { useSceneDraft } from "./SceneDraft";

export default function SettingsGroupRail({
  active,
  onSelect,
}: {
  active: SettingsGroupId;
  onSelect: (id: SettingsGroupId) => void;
}) {
  const { surface, pending, pendingDirector, pendingCrossword } = useSceneDraft();
  const changed = cardsForStagedKeys(
    Object.keys(pending),
    Object.keys(pendingDirector),
    Object.keys(pendingCrossword),
  );

  return (
    <Stack
      component="nav"
      aria-label="Settings groups"
      spacing={0.5}
      sx={{
        position: { md: "sticky" },
        top: 16,
        alignSelf: "flex-start",
        width: { xs: "100%", md: 208 },
        flexShrink: 0,
      }}
    >
      {groupsForSurface(surface).map((g) => {
        const dirtyHere = changed.filter((c) => c.group === g.id).length;
        const selected = g.id === active;
        return (
          <ButtonBase
            key={g.id}
            onClick={() => onSelect(g.id)}
            aria-current={selected ? "page" : undefined}
            sx={{
              justifyContent: "flex-start",
              textAlign: "left",
              px: 1.25,
              py: 1,
              borderRadius: 1,
              border: 1,
              borderColor: selected ? "primary.main" : "transparent",
              bgcolor: selected ? "action.selected" : "transparent",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: selected ? 700 : 500 }}>
                {g.label}
              </Typography>
            </Box>
            {dirtyHere > 0 && (
              <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 700, ml: 1 }}>
                {dirtyHere}
              </Typography>
            )}
          </ButtonBase>
        );
      })}
    </Stack>
  );
}
