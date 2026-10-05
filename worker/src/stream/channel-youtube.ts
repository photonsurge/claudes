/**
 * The channel's YouTube publishing metadata — title / description templates and
 * the thumbnail source the operator set on /admin/scenes/:id (ControlState.youtube).
 * Runs and constant streams no longer carry their own description/thumbnail:
 * the channel is the single place to edit them. A run/slot title still overrides.
 *
 * Also which YouTube account a run publishes to (crossword plan §10): the run's
 * pick, else the account stored on the channel record. A crossword channel never
 * falls back further; a weather channel keeps the most-recently-connected default.
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import {
  DEFAULT_YOUTUBE_SETTINGS,
  MAIN_SCENE_ID,
  sceneSurface,
  type SceneSurface,
  type YoutubeSettings,
} from "@photonsurge/shared/control";

/** A channel's YouTube settings plus what go-live needs to know about the channel itself. */
export interface ChannelYoutube extends YoutubeSettings {
  /** "globe" when the record says nothing (and always for the main channel). */
  surface?: SceneSurface;
  /** The channel's display name, when it has one. */
  name?: string;
}

export async function channelYoutubeSettings(sceneId: string): Promise<ChannelYoutube> {
  const db = await getAppDb();
  const doc = sceneId === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(sceneId);
  const yt = (doc as { youtube?: Partial<YoutubeSettings> } | null)?.youtube ?? {};
  const name = (doc as { name?: unknown } | null)?.name;
  return {
    title: typeof yt.title === "string" ? yt.title : DEFAULT_YOUTUBE_SETTINGS.title,
    description: typeof yt.description === "string" ? yt.description : DEFAULT_YOUTUBE_SETTINGS.description,
    thumbnailUrl: typeof yt.thumbnailUrl === "string" ? yt.thumbnailUrl : DEFAULT_YOUTUBE_SETTINGS.thumbnailUrl,
    accountId: typeof yt.accountId === "string" ? yt.accountId.trim() : "",
    surface: sceneId === MAIN_SCENE_ID ? "globe" : sceneSurface(doc as { surface?: unknown } | null),
    ...(typeof name === "string" && name ? { name } : {}),
  };
}

/** Go-live refused because the YouTube account can't be decided or used (§10). */
export class RunAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunAccountError";
  }
}

/**
 * The YouTube account a channel run publishes to: the run's own pick, else the
 * channel record's `youtube.accountId`. For a crossword channel that is the end
 * of it — with neither, or with an account that is gone or needs reconnecting,
 * it throws `RunAccountError` (never the most recently connected account). For
 * a weather channel `undefined` is returned when neither is set, which the
 * YouTube client resolves to today's default.
 */
export async function resolveRunAccountId(
  sceneId: string,
  requested: string | undefined,
  channel: ChannelYoutube,
): Promise<string | undefined> {
  const picked = (requested ?? "").trim() || (channel.accountId ?? "").trim();
  if (channel.surface !== "crossword") return picked || undefined;
  const label = channel.name || sceneId;
  if (!picked) {
    throw new RunAccountError(
      `crossword channel "${label}" has no YouTube channel: pick one in Go live or set it on the channel's ` +
        `YouTube card. A crossword never goes out on a default account.`,
    );
  }
  const account = await (await getAppDb()).getYoutubeAccount(picked);
  if (!account || !account.refreshTokenEnc) {
    throw new RunAccountError(`YouTube channel "${picked}" is not connected — connect it on /admin/youtube`);
  }
  if (account.authError) {
    throw new RunAccountError(
      `YouTube channel "${account.channelTitle || picked}" needs reconnecting on /admin/youtube before it can go live`,
    );
  }
  return picked;
}
