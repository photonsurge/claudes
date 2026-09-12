/**
 * The channel's YouTube publishing metadata — title / description templates and
 * the thumbnail source the operator set on /admin/scenes/:id (ControlState.youtube).
 * Runs and constant streams no longer carry their own description/thumbnail:
 * the channel is the single place to edit them. A run/slot title still overrides.
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_YOUTUBE_SETTINGS, MAIN_SCENE_ID, type YoutubeSettings } from "@photonsurge/shared/control";

export async function channelYoutubeSettings(sceneId: string): Promise<YoutubeSettings> {
  const db = await getAppDb();
  const doc = sceneId === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(sceneId);
  const yt = (doc as { youtube?: Partial<YoutubeSettings> } | null)?.youtube ?? {};
  return {
    title: typeof yt.title === "string" ? yt.title : DEFAULT_YOUTUBE_SETTINGS.title,
    description: typeof yt.description === "string" ? yt.description : DEFAULT_YOUTUBE_SETTINGS.description,
    thumbnailUrl: typeof yt.thumbnailUrl === "string" ? yt.thumbnailUrl : DEFAULT_YOUTUBE_SETTINGS.thumbnailUrl,
  };
}
