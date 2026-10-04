"use client";

/**
 * /admin/scenes/:id — per-channel settings.
 *
 * The page is a rail of GROUPS over a column of cards. `SceneDraftProvider`
 * above both owns the channel's two documents (ControlState + DirectorConfig)
 * and hands every card a merged draft, so cards are pure forms: switching group
 * unmounts them and loses nothing, because no card holds server data.
 *
 * Nothing reaches the channel until the Save bar applies the accumulated delta,
 * which still can't clobber whatever the operator is driving live.
 *
 * Which cards exist, which group each belongs to and which kind of channel
 * (weather or crossword) each applies to is `scenes/catalog.ts` — this file
 * only maps a card id to its component. The provider mounts once the channel's
 * kind is known, since that decides which documents it reads. `?s=<group>` selects a group
 * and `#<card>` deep-links to one (the links from /control's director holds,
 * the stream panel and the streams slot card land that way).
 */
import { useCallback, useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { MAIN_SCENE_ID, sceneSurface, watchPath, type SceneMeta } from "@photonsurge/shared/control";
import { consoleHref } from "../../../../lib/channel-links";
import { listScenes } from "../../../../lib/scenes";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import SceneDraftProvider, { useSceneDraft } from "../../../../components/admin/scenes/SceneDraft";
import SceneSaveBar from "../../../../components/admin/scenes/SceneSaveBar";
import SettingsGroupRail from "../../../../components/admin/scenes/SettingsGroupRail";
import {
  cardsInGroup,
  getCard,
  groupsForSurface,
  type SettingsGroupId,
} from "../../../../components/admin/scenes/catalog";
import {
  CrosswordChatSettings,
  CrosswordDifficultySettings,
  CrosswordOnSettings,
  CrosswordPacingSettings,
  CrosswordPuzzleSettings,
} from "../../../../components/admin/scenes/CrosswordGameSettings";
import AboutCardSettings from "../../../../components/admin/scenes/AboutCardSettings";
import AudioSettings from "../../../../components/admin/scenes/AudioSettings";
import CameraSettings from "../../../../components/admin/scenes/CameraSettings";
import ChannelSettings from "../../../../components/admin/scenes/ChannelSettings";
import DirectorSettings from "../../../../components/admin/scenes/DirectorSettings";
import DirectorPacingSettings from "../../../../components/admin/scenes/DirectorPacingSettings";
import DirectorPoolSettings from "../../../../components/admin/scenes/DirectorPoolSettings";
import DirectorTourSettings from "../../../../components/admin/scenes/DirectorTourSettings";
import DirectorLooksSettings from "../../../../components/admin/scenes/DirectorLooksSettings";
import BreakInSettings from "../../../../components/admin/scenes/BreakInSettings";
import ChatCommandsSettings from "../../../../components/admin/scenes/ChatCommandsSettings";
import PaceSettings from "../../../../components/admin/scenes/PaceSettings";
import ReportSettings from "../../../../components/admin/scenes/ReportSettings";
import SlidesSettings from "../../../../components/admin/scenes/SlidesSettings";
import ThemeSettings from "../../../../components/admin/scenes/ThemeSettings";
import TickerSettings from "../../../../components/admin/scenes/TickerSettings";
import YoutubeSettings from "../../../../components/admin/scenes/YoutubeSettings";

/** Card id → component. The catalog holds everything else about each card. */
const CARD_COMPONENTS: Record<string, ComponentType> = {
  widgets: ChannelSettings,
  report: ReportSettings,
  deck: SlidesSettings,
  crawl: TickerSettings,
  theme: ThemeSettings,
  camera: CameraSettings,
  audio: AudioSettings,
  pace: PaceSettings,
  director: DirectorSettings,
  "director-pacing": DirectorPacingSettings,
  "director-pools": DirectorPoolSettings,
  "director-tours": DirectorTourSettings,
  "director-looks": DirectorLooksSettings,
  "director-break-ins": BreakInSettings,
  chat: ChatCommandsSettings,
  about: AboutCardSettings,
  youtube: YoutubeSettings,
  "crossword-on": CrosswordOnSettings,
  "crossword-pacing": CrosswordPacingSettings,
  "crossword-difficulty": CrosswordDifficultySettings,
  "crossword-puzzles": CrosswordPuzzleSettings,
  "crossword-chat": CrosswordChatSettings,
};

export default function ChannelSettingsPage() {
  const params = useParams<{ id: string }>();
  const sceneId = params?.id ?? MAIN_SCENE_ID;
  const [scene, setScene] = useState<SceneMeta | null>(null);
  // The list has answered (the scene may still be unknown): the kind is settled.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    listScenes().then((list) => {
      setScene(list.find((s) => s.id === sceneId) ?? null);
      setLoaded(true);
    });
  }, [sceneId]);

  const name = scene?.name ?? sceneId;
  const surface = sceneSurface(scene);
  const control = consoleHref({ id: sceneId, surface });
  const watch = watchPath({ id: sceneId, surface });

  return (
    <AdminPageShell
      title={`Channel: ${name}`}
      crumbs={[{ href: "/admin/scenes", label: "Channels" }, { label: name }]}
      description="Everything this channel looks, sounds and behaves like on air. Changes stay staged until you press Save, then apply live to its /watch output."
      maxWidth={1060}
      actions={
        <>
          <Button component={Link} href={control} variant="outlined" size="small">
            {surface === "crossword" ? "Desk" : "Control"}
          </Button>
          <MuiLink component={Link} href={watch} target="_blank" variant="body2" sx={{ whiteSpace: "nowrap" }}>
            Watch ↗
          </MuiLink>
        </>
      }
    >
      {loaded ? (
        <SceneDraftProvider sceneId={sceneId} surface={surface}>
          <SettingsBody />
        </SceneDraftProvider>
      ) : (
        <Skeleton variant="rounded" height={180} aria-label="Loading channel" />
      )}
    </AdminPageShell>
  );
}

/** Inside the provider, so the rail can count what is staged in each group. */
function SettingsBody() {
  const { ready, surface } = useSceneDraft();
  const groups = groupsForSurface(surface);
  // Weather opens on Layout, a crossword on Game: the first group it has.
  const [group, setGroup] = useState<SettingsGroupId>(groups[0].id);
  const [anchor, setAnchor] = useState<string | null>(null);

  // Adopt the URL once: `#card` wins over `?s=group`, since a deep link names a
  // card and the group it lives in is implied.
  useEffect(() => {
    // Only a card or group this kind of channel has counts.
    const hash = window.location.hash.replace(/^#/, "");
    const card = hash ? getCard(hash) : undefined;
    const fromHash = card && card.surfaces.includes(surface) ? card.group : undefined;
    const fromQuery = new URLSearchParams(window.location.search).get("s");
    if (fromHash) {
      setGroup(fromHash);
      setAnchor(hash);
    } else if (groups.some((g) => g.id === fromQuery)) {
      setGroup(fromQuery as SettingsGroupId);
    }
  }, []);

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
      <SettingsGroupRail active={group} onSelect={select} />

      <Box sx={{ flex: 1, minWidth: 0, maxWidth: 760 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {def.blurb}
        </Typography>

        {!ready ? (
          <Stack spacing={2} aria-label="Loading channel">
            <Skeleton variant="rounded" height={180} />
            <Skeleton variant="rounded" height={140} />
          </Stack>
        ) : (
          <Stack spacing={2}>
            {cardsInGroup(def.id, surface).map((card) => {
              const Card = CARD_COMPONENTS[card.id];
              return Card ? <Card key={card.id} /> : null;
            })}
          </Stack>
        )}

        <SceneSaveBar />
      </Box>
    </Stack>
  );
}
