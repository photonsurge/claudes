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
 * Which cards exist, and which group each belongs to, is `scenes/catalog.ts` —
 * this file only maps a card id to its component. `?s=<group>` selects a group
 * and `#<card>` deep-links to one (the links from /control's director holds,
 * the stream panel and the streams slot card land that way).
 */
import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import { MAIN_SCENE_ID, type SceneMeta } from "@photonsurge/shared/control";
import { listScenes } from "../../../../lib/scenes";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import SceneDraftProvider from "../../../../components/admin/scenes/SceneDraft";
import SettingsBody from "../../../../components/admin/scenes/SettingsBody";
import type { SettingsGroupId } from "../../../../components/admin/scenes/catalog";
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
};

const DEFAULT_GROUP: SettingsGroupId = "layout";

export default function ChannelSettingsPage() {
  const params = useParams<{ id: string }>();
  const sceneId = params?.id ?? MAIN_SCENE_ID;
  const [scene, setScene] = useState<SceneMeta | null>(null);

  useEffect(() => {
    listScenes().then((list) => setScene(list.find((s) => s.id === sceneId) ?? null));
  }, [sceneId]);

  const name = scene?.name ?? sceneId;
  const control = sceneId === MAIN_SCENE_ID ? "/control" : `/control?scene=${sceneId}`;
  const watch = `/watch/${sceneId}`;

  return (
    <AdminPageShell
      title={`Channel: ${name}`}
      crumbs={[{ href: "/admin/scenes", label: "Channels" }, { label: name }]}
      description="Everything this channel looks, sounds and behaves like on air. Changes stay staged until you press Save, then apply live to its /watch output."
      maxWidth={1060}
      actions={
        <>
          <Button component={Link} href={control} variant="outlined" size="small">
            Control
          </Button>
          <MuiLink component={Link} href={watch} target="_blank" variant="body2" sx={{ whiteSpace: "nowrap" }}>
            Watch ↗
          </MuiLink>
        </>
      }
    >
      <SceneDraftProvider sceneId={sceneId}>
        <SettingsBody components={CARD_COMPONENTS} defaultGroup={DEFAULT_GROUP} />
      </SceneDraftProvider>
    </AdminPageShell>
  );
}
