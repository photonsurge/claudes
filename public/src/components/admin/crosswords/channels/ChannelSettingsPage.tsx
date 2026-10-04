"use client";

/**
 * /admin/crosswords/channels/:id — a crossword channel's settings (plan §8.2),
 * laid out like the weather channel's page: cards in groups (Look, Game,
 * YouTube), one Save bar, nothing live until Save. Look and Game save to the
 * crossword config; the music bed and YouTube cards save to the channel record.
 * `?s=<group>` selects a group and `#<card>` deep-links to one.
 */
import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import MuiLink from "@mui/material/Link";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { sceneSurface, outputPath, type SceneMeta } from "@photonsurge/shared/control";
import { consoleHref } from "../../../../lib/channel-links";
import { listScenes } from "../../../../lib/scenes";
import AdminPageShell from "../../AdminPageShell";
import ChannelDraftProvider, { useChannelDraft } from "./ChannelDraft";
import ChannelSaveBar from "./ChannelSaveBar";
import { BrandCard, MusicCard } from "./LookCards";
import { ChatCard, DifficultyCard, OnCard, PacingCard, PuzzlesCard } from "./GameCards";
import { YoutubeBroadcastCard, YoutubeChannelCard } from "./YoutubeCards";
import {
  CHANNEL_GROUPS,
  cardsInChannelGroup,
  changedCards,
  getChannelCard,
  type ChannelGroupId,
} from "./catalog";

const CARD_COMPONENTS: Record<string, ComponentType> = {
  brand: BrandCard,
  music: MusicCard,
  pacing: PacingCard,
  difficulty: DifficultyCard,
  puzzles: PuzzlesCard,
  chat: ChatCard,
  on: OnCard,
  "youtube-channel": YoutubeChannelCard,
  "youtube-broadcast": YoutubeBroadcastCard,
};

export default function ChannelSettingsPage({ sceneId }: { sceneId: string }) {
  const [scene, setScene] = useState<SceneMeta | null>(null);
  useEffect(() => {
    listScenes().then((list) => setScene(list.find((s) => s.id === sceneId) ?? null));
  }, [sceneId]);

  const name = scene?.name ?? sceneId;
  const output = outputPath({ id: sceneId, surface: "crossword" });

  return (
    <AdminPageShell
      title={`Crossword channel: ${name}`}
      crumbs={[
        { href: "/admin/scenes", label: "Channels" },
        { label: name },
      ]}
      description="The look, the game and the YouTube channel of this crossword. Changes stay staged until you press Save."
      maxWidth={1060}
      actions={
        <>
          <Button component={Link} href={consoleHref({ id: sceneId, surface: "crossword" })} variant="outlined" size="small">
            Desk
          </Button>
          <MuiLink component={Link} href={output} target="_blank" variant="body2" sx={{ whiteSpace: "nowrap" }}>
            Output ↗
          </MuiLink>
        </>
      }
    >
      {scene && sceneSurface(scene) !== "crossword" ? (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          This is a weather channel; its settings are on the{" "}
          <MuiLink component={Link} href={`/admin/scenes/${encodeURIComponent(sceneId)}`}>weather settings page</MuiLink>.
        </Typography>
      ) : (
        <ChannelDraftProvider sceneId={sceneId}>
          <SettingsBody />
        </ChannelDraftProvider>
      )}
    </AdminPageShell>
  );
}

/** Inside the provider, so the rail can count what is staged in each group. */
function SettingsBody() {
  const { ready, pending, pendingCrossword, saved } = useChannelDraft();
  const [group, setGroup] = useState<ChannelGroupId>("look");
  const [anchor, setAnchor] = useState<string | null>(null);

  // Adopt the URL once: `#card` wins over `?s=group`.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const card = hash ? getChannelCard(hash) : undefined;
    const fromQuery = new URLSearchParams(window.location.search).get("s");
    if (card) {
      setGroup(card.group);
      setAnchor(hash);
    } else if (CHANNEL_GROUPS.some((g) => g.id === fromQuery)) {
      setGroup(fromQuery as ChannelGroupId);
    }
  }, []);

  useEffect(() => {
    if (!anchor || !ready) return;
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    setAnchor(null);
  }, [anchor, ready, group]);

  const select = (id: ChannelGroupId) => {
    setGroup(id);
    const url = new URL(window.location.href);
    url.searchParams.set("s", id);
    url.hash = "";
    window.history.replaceState(null, "", url);
  };

  const changed = changedCards(pending, pendingCrossword, saved.youtube);
  const def = CHANNEL_GROUPS.find((g) => g.id === group) ?? CHANNEL_GROUPS[0];

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} sx={{ alignItems: "flex-start" }}>
      <Stack component="nav" aria-label="Settings groups" spacing={0.5} sx={{ width: { xs: "100%", md: 180 }, flexShrink: 0, mt: 2 }}>
        {CHANNEL_GROUPS.map((g) => {
          const n = changed.filter((c) => c.group === g.id).length;
          return (
            <ButtonBase
              key={g.id}
              onClick={() => select(g.id)}
              aria-current={g.id === group ? "page" : undefined}
              sx={{
                justifyContent: "space-between",
                px: 1.5,
                py: 0.75,
                borderRadius: 1,
                textAlign: "left",
                bgcolor: g.id === group ? "action.selected" : "transparent",
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: g.id === group ? 700 : 400 }}>
                {g.label}
              </Typography>
              {n > 0 && (
                <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 700 }}>
                  {n} unsaved
                </Typography>
              )}
            </ButtonBase>
          );
        })}
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0, mt: 2, width: "100%" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {def.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          {def.blurb}
        </Typography>
        {!ready ? (
          <Stack spacing={2}>
            <Skeleton variant="rounded" height={140} aria-label="Loading settings" />
            <Skeleton variant="rounded" height={140} />
          </Stack>
        ) : (
          <Stack spacing={2}>
            {cardsInChannelGroup(def.id).map((card) => {
              const Card = CARD_COMPONENTS[card.id];
              return Card ? <Card key={card.id} /> : null;
            })}
          </Stack>
        )}
        <ChannelSaveBar />
      </Box>
    </Stack>
  );
}
