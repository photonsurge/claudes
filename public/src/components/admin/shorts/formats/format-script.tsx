"use client";

/**
 * The format's most recent script, for the editor: the YouTube video card
 * previews its title against that script's stamped values (§6.8,
 * `ShortScript.values`), and Play sample plays it. Provided by the editor page;
 * a card outside it (or a format with no script yet) gets null and previews
 * with the codes' example values.
 */
import { createContext, useContext } from "react";
import type { ShortScript } from "@photonsurge/shared/short-script";
import type { VideoTextValues } from "@photonsurge/shared/video-text";
import { exampleVideoValues } from "../../../../lib/short-formats";

export const FormatScriptContext = createContext<ShortScript | null>(null);

export const useFormatScript = (): ShortScript | null => useContext(FormatScriptContext);

/**
 * What a preview resolves `%{name}` codes with, and a line saying where they
 * came from. A script's stamped values win (generate stamps them; scripts made
 * before that carry none); every code the script doesn't stamp falls back to
 * its example, and `%{format}` is the format's own (draft) name.
 */
export function previewValues(script: ShortScript | null, formatName: string): { values: VideoTextValues; note: string } {
  const stamped = (script as (ShortScript & { values?: Record<string, unknown> }) | null)?.values;
  const own: Record<string, string> = {};
  if (stamped && typeof stamped === "object") {
    for (const [k, v] of Object.entries(stamped)) if (typeof v === "string") own[k] = v;
  }
  const values: VideoTextValues = { ...exampleVideoValues(), format: formatName, ...own };
  const hasOwn = Object.keys(own).length > 0;
  const note = hasOwn
    ? `Codes use the values of “${script!.title}”, this format's most recent script. %{duration} and the date are filled at render.`
    : script
      ? `“${script.title}” has no stamped values yet, so codes use example values.`
      : "No script in this format yet — codes use example values.";
  return { values, note };
}
