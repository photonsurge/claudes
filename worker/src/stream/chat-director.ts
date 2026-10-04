/**
 * Chat → director: the viewer grammar that moves the camera. Each request is a
 * row in the scene's director command queue (source: viewer), carrying the
 * channel's pacing so the loop can air it behind the operator and breaking
 * news. This hook only checks the channel's policy and words the reply; what
 * a place or look actually resolves to is the loop's business.
 *
 *   :show japan · :go iberia · :show quakes · :quake · :storm · :volcano
 *   :flight · :ship · :ocean · :space · :world · :roundup [place]
 *   :mode aurora (a map look, always at the next shot change)
 *   :next · :clear (mods, when the channel allows them)
 *
 * See docs/director-programme-plan.md §5.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { SegmentKind } from "@photonsurge/shared/director";
import type { CommandTarget, DirectorCommand, DirectorOp } from "@photonsurge/shared/director-commands";
import { resolvePlaceQuery } from "@photonsurge/shared/director-places";
import { INTRO_MAP_TYPES, OCEAN_MAP_TYPES } from "@photonsurge/shared/director-rois";
import { requestedHoldS } from "@photonsurge/shared/chat-policy";
import type { DirectorHook } from "./chat-handler";

/** A viewer's request lapses after this — a request from an hour ago must not fire later. */
export const VIEWER_COMMAND_TTL_MS = 10 * 60_000;

/** Words viewers use for each kind (`:show quakes`, `:quake`). */
export const KIND_WORDS: Record<string, SegmentKind> = {
  quake: "quake",
  quakes: "quake",
  earthquake: "quake",
  earthquakes: "quake",
  storm: "storm",
  storms: "storm",
  volcano: "volcano",
  volcanoes: "volcano",
  volcanos: "volcano",
  flight: "flight",
  flights: "flight",
  plane: "flight",
  planes: "flight",
  ship: "ship",
  ships: "ship",
  ocean: "ocean",
  oceans: "ocean",
  space: "orbital",
  orbit: "orbital",
  world: "global",
  globe: "global",
};

const KIND_LABEL: Partial<Record<SegmentKind, string>> = {
  quake: "an earthquake",
  storm: "a storm",
  volcano: "a volcano",
  flight: "a flight",
  ship: "a ship",
  ocean: "the oceans",
  orbital: "space",
  global: "the world",
};

const MAP_LOOKS = [...INTRO_MAP_TYPES, ...OCEAN_MAP_TYPES];

const isViewerRequest = (c: DirectorCommand) => c.source.kind === "viewer" && (c.cmd.op === "cut" || c.cmd.op === "queue");

/** The hook, bound to a db. Returns the reply, or null to stay silent. */
export function makeDirectorHook(db: AppDb): DirectorHook {
  return async ({ sceneId, policy, msg, parsed, now }) => {
    const dir = policy.director;
    const mod = !!msg.isMod || !!msg.isOwner;
    const at = `@${msg.author}`;
    const words = parsed.args.join(" ").trim();

    // Work out what was asked before touching the db; unknown words stay silent.
    let target: CommandTarget | null = null;
    let label = "";
    let mapLook = false;
    let control: DirectorOp | null = null;

    const kindRequest = (kind: SegmentKind): string | null => {
      if (!dir.ops.cut || !dir.kinds[kind]) return `${at} ${KIND_LABEL[kind] ?? kind} isn't something viewers can ask for here`;
      target = { type: "kind", kind };
      label = KIND_LABEL[kind] ?? kind;
      return null;
    };

    switch (parsed.cmd) {
      case "show":
      case "go": {
        if (!dir.enabled) return null;
        if (!words) return `${at} try :show <place>`;
        const kind = KIND_WORDS[words.toLowerCase()];
        if (kind) {
          const refused = kindRequest(kind);
          if (refused) return refused;
          break;
        }
        if (!dir.ops.cut) return null;
        const match = resolvePlaceQuery(words);
        if (match) {
          const ok = match.kind === "country" ? dir.places.countries : dir.places.regions;
          if (!ok) return `${at} ${match.shot.name} isn't something viewers can ask for here`;
          target = { type: "place", query: match.shot.name };
          label = match.shot.name;
        } else if (dir.places.cities) {
          target = { type: "place", query: words };
          label = words;
        } else {
          return `${at} I don't know "${words}"`;
        }
        break;
      }

      case "roundup": {
        if (!dir.enabled || !dir.ops.roundup) return null;
        if (words) {
          const match = resolvePlaceQuery(words);
          if (!match) return `${at} I don't know "${words}"`;
          target = { type: "roundup", place: match.shot.name };
          label = `the ${match.shot.name} round-up`;
        } else {
          target = { type: "roundup" };
          label = "the world round-up";
        }
        break;
      }

      case "mode": {
        // `:mode` alone is the always-on "what's on now" (chat-commands.ts).
        if (!dir.enabled || !policy.mapType.enabled || !words) return null;
        const wanted = words.toLowerCase();
        const look = MAP_LOOKS.find((t) => t.id === wanted || t.title.toLowerCase() === wanted);
        if (!look) return `${at} "${words}" isn't a map look — try :modes`;
        if (policy.mapType.allowed.length && !policy.mapType.allowed.includes(look.id)) {
          return `${at} ${look.title} isn't something viewers can ask for here`;
        }
        target = { type: "mapType", id: look.id };
        label = look.title;
        mapLook = true;
        break;
      }

      case "next":
        if (!dir.enabled || !dir.ops.skip || !mod) return null;
        control = { op: "skip" };
        break;

      case "clear":
        if (!dir.enabled || !dir.ops.clear || !mod) return null;
        break;

      default: {
        const kind = KIND_WORDS[parsed.cmd];
        if (!kind || !dir.enabled) return null;
        const refused = kindRequest(kind);
        if (refused) return refused;
      }
    }

    const cfg = await db.getOrInitDirectorConfig(sceneId);
    if (cfg.mode === "script") return `${at} a scripted video is playing — try again after it`;
    if (cfg.mode !== "auto") return `${at} the director is off right now`;

    const source = {
      kind: "viewer" as const,
      platform: msg.platform,
      author: msg.author,
      ...(msg.isMod ? { isMod: true } : {}),
    };

    if (parsed.cmd === "clear") {
      // A mod clears viewers' requests only — never the operator's.
      const pending = await db.directorCommands.pending(sceneId);
      let n = 0;
      for (const c of pending.filter(isViewerRequest)) {
        if (await db.directorCommands.settle(c.id, "dropped", { note: `cleared by ${at}`, now })) n++;
      }
      return n ? `${at} cleared ${n} request${n === 1 ? "" : "s"}` : `${at} nothing to clear`;
    }

    if (control) {
      await db.directorCommands.enqueue({ sceneId, source, cmd: control, now, ttlMs: VIEWER_COMMAND_TTL_MS });
      return `${at} skipped to the next shot`;
    }
    if (!target) return null;

    const waiting = (await db.directorCommands.pending(sceneId)).filter(isViewerRequest).length;
    if (waiting >= dir.maxQueued) return `${at} the queue is full, try again in a minute`;

    const immediate = dir.mode === "immediate" && !mapLook;
    const holdS = requestedHoldS(parsed.minutes, mapLook ? policy.mapType : dir);
    await db.directorCommands.enqueue({
      sceneId,
      source,
      cmd: { op: immediate ? "cut" : "queue", target, holdS },
      now,
      ttlMs: VIEWER_COMMAND_TTL_MS,
      viewer: { everyS: dir.everyS, immediate, allowCities: dir.places.cities },
    });
    const when = immediate ? "coming up" : "at the next shot change";
    return waiting ? `${at} → ${label} is queued (#${waiting + 1})` : `${at} → ${label} ${when}`;
  };
}
