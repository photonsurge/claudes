/**
 * Test harness for the settings cards. Cards are pure forms over the page's
 * draft, so a card test needs a draft — not a fetching provider and not a
 * mocked `lib/scenes`. `renderInDraft` supplies one, seeded with whatever
 * ControlState / DirectorConfig the test cares about, and records every delta
 * the card stages.
 *
 * The real provider (fetching, merging, live-follow, Save) is covered by
 * SceneDraft.test.tsx instead. Not a `.test.` file, so jest doesn't collect it.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import {
  DEFAULT_CONTROL_STATE,
  mergeControlState,
  type ControlState,
} from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from "@photonsurge/shared/director";
import type { ShortFormat } from "@photonsurge/shared/short-format";
import type { ShortFormatPatch } from "../../../lib/short-formats";
import { mergeConfig } from "../../../lib/director";
import { SceneDraftContext, type SceneDraftValue } from "./SceneDraft";

export type DraftHarness = RenderResult & {
  /** Every ControlState delta staged, in order. */
  staged: Partial<ControlState>[];
  /** Every DirectorConfig delta staged, in order. */
  stagedDirector: Partial<DirectorConfig>[];
  /** Every short-settings delta staged, in order (format editor cards). */
  stagedFormat: ShortFormatPatch[];
  /** The most recent delta of each kind — what a test usually asserts on. */
  last: () => Partial<ControlState>;
  lastDirector: () => Partial<DirectorConfig>;
  lastFormat: () => ShortFormatPatch;
};

export function renderInDraft(
  ui: ReactElement,
  opts: {
    sceneId?: string;
    state?: Partial<ControlState>;
    config?: Partial<DirectorConfig>;
    /** A format editor card's short settings (absent = a channel page). */
    format?: ShortFormat;
  } = {},
): DraftHarness {
  const staged: Partial<ControlState>[] = [];
  const stagedDirector: Partial<DirectorConfig>[] = [];
  const stagedFormat: ShortFormatPatch[] = [];

  const result = render(
    <TestDraftProvider
      sceneId={opts.sceneId ?? "wind"}
      initialState={mergeControlState(DEFAULT_CONTROL_STATE, opts.state ?? {})}
      initialConfig={mergeConfig(DEFAULT_DIRECTOR_CONFIG, opts.config ?? {})}
      onStage={(over) => staged.push(over)}
      onStageDirector={(over) => stagedDirector.push(over)}
      initialFormat={opts.format ?? null}
      onStageFormat={(over) => stagedFormat.push(over)}
    >
      {ui}
    </TestDraftProvider>,
  );

  return {
    ...result,
    staged,
    stagedDirector,
    stagedFormat,
    last: () => staged[staged.length - 1],
    lastDirector: () => stagedDirector[stagedDirector.length - 1],
    lastFormat: () => stagedFormat[stagedFormat.length - 1],
  };
}

/**
 * A real draft, minus the network: it merges staged deltas over the seed state
 * exactly as the provider does, so a card re-renders from its own edit the way
 * it will in the page.
 */
function TestDraftProvider({
  sceneId,
  initialState,
  initialConfig,
  onStage,
  onStageDirector,
  initialFormat,
  onStageFormat,
  children,
}: {
  sceneId: string;
  initialState: ControlState;
  initialConfig: DirectorConfig;
  onStage: (over: Partial<ControlState>) => void;
  onStageDirector: (over: Partial<DirectorConfig>) => void;
  initialFormat: ShortFormat | null;
  onStageFormat: (over: ShortFormatPatch) => void;
  children: ReactNode;
}) {
  const [pending, setPending] = useState<Partial<ControlState>>({});
  const [pendingDirector, setPendingDirector] = useState<Partial<DirectorConfig>>({});
  const [pendingFormat, setPendingFormat] = useState<ShortFormatPatch>({});

  const value = useMemo<SceneDraftValue>(
    () => ({
      sceneId,
      ready: true,
      state: mergeControlState(initialState, pending),
      config: mergeConfig(initialConfig, pendingDirector),
      stage: (over) => {
        onStage(over);
        setPending((prev) => ({ ...prev, ...over }));
      },
      stageDirector: (over) => {
        onStageDirector(over);
        setPendingDirector((prev) => ({ ...prev, ...over }));
      },
      format: initialFormat ? ({ ...initialFormat, ...pendingFormat } as ShortFormat) : null,
      stageFormat: (over) => {
        onStageFormat(over);
        setPendingFormat((prev) => ({ ...prev, ...over }));
      },
      pending,
      pendingDirector,
      pendingFormat,
      dirty:
        Object.keys(pending).length > 0 ||
        Object.keys(pendingDirector).length > 0 ||
        Object.keys(pendingFormat).length > 0,
      conflictKeys: [],
      saving: false,
      saveError: null,
      save: () => {},
      discard: () => {
        setPending({});
        setPendingDirector({});
        setPendingFormat({});
      },
    }),
    [
      sceneId,
      initialState,
      initialConfig,
      initialFormat,
      pending,
      pendingDirector,
      pendingFormat,
      onStage,
      onStageDirector,
      onStageFormat,
    ],
  );

  return <SceneDraftContext.Provider value={value}>{children}</SceneDraftContext.Provider>;
}
