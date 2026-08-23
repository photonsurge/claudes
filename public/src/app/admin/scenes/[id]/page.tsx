"use client";

/**
 * /admin/scenes/:id — per-channel settings. The cards STAGE their edits into a
 * shared SceneDraftProvider; nothing reaches the channel until the sticky Save
 * bar applies the accumulated DELTA patch — which still can't clobber the
 * operator's live state. Room to grow into other per-channel config
 * (destination, …) alongside the current cards.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import { MAIN_SCENE_ID, type SceneMeta } from "@photonsurge/shared/control";
import { listScenes } from "../../../../lib/scenes";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import CameraSettings from "../../../../components/admin/scenes/CameraSettings";
import ChannelSettings from "../../../../components/admin/scenes/ChannelSettings";
import SceneDraftProvider from "../../../../components/admin/scenes/SceneDraft";
import SlidesSettings from "../../../../components/admin/scenes/SlidesSettings";
import ReportSettings from "../../../../components/admin/scenes/ReportSettings";
import ThemeSettings from "../../../../components/admin/scenes/ThemeSettings";

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
      description="On-air widgets, camera motion, the bottom-left slide deck and the channel's brand. Changes stay staged here until you press Save, then apply live to its /watch output."
      maxWidth={760}
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
        <Stack spacing={2}>
          <ChannelSettings sceneId={sceneId} />
          <CameraSettings sceneId={sceneId} />
          <ReportSettings sceneId={sceneId} />
          <SlidesSettings sceneId={sceneId} />
          <ThemeSettings sceneId={sceneId} />
        </Stack>
      </SceneDraftProvider>
    </AdminPageShell>
  );
}
