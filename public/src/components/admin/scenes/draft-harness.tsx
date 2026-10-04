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
import { DEFAULT_CROSSWORD_CONFIG, type CrosswordConfig } from "@photonsurge/shared/crossword";
import type { SceneSurface } from "@photonsurge/shared/control";
import { mergeConfig } from "../../../lib/director";
import { SceneDraftContext, type SceneDraftValue } from "./SceneDraft";

export type DraftHarness = RenderResult & {
  /** Every ControlState delta staged, in order. */
  staged: Partial<ControlState>[];
  /** Every DirectorConfig delta staged, in order. */
  stagedDirector: Partial<DirectorConfig>[];
  /** Every CrosswordConfig delta staged, in order. */
  stagedCrossword: Partial<CrosswordConfig>[];
  /** The most recent delta of each kind — what a test usually asserts on. */
  last: () => Partial<ControlState>;
  lastDirector: () => Partial<DirectorConfig>;
  lastCrossword: () => Partial<CrosswordConfig>;
};

export function renderInDraft(
  ui: ReactElement,
  opts: {
    sceneId?: string;
    state?: Partial<ControlState>;
    config?: Partial<DirectorConfig>;
    crossword?: Partial<CrosswordConfig>;
    surface?: SceneSurface;
  } = {},
): DraftHarness {
  const staged: Partial<ControlState>[] = [];
  const stagedDirector: Partial<DirectorConfig>[] = [];
  const stagedCrossword: Partial<CrosswordConfig>[] = [];

  const result = render(
    <TestDraftProvider
      sceneId={opts.sceneId ?? "wind"}
      initialState={mergeControlState(DEFAULT_CONTROL_STATE, opts.state ?? {})}
      initialConfig={mergeConfig(DEFAULT_DIRECTOR_CONFIG, opts.config ?? {})}
      initialCrossword={{ ...DEFAULT_CROSSWORD_CONFIG, ...opts.crossword }}
      surface={opts.surface ?? (opts.crossword ? "crossword" : "globe")}
      onStage={(over) => staged.push(over)}
      onStageDirector={(over) => stagedDirector.push(over)}
      onStageCrossword={(over) => stagedCrossword.push(over)}
    >
      {ui}
    </TestDraftProvider>,
  );

  return {
    ...result,
    staged,
    stagedDirector,
    stagedCrossword,
    last: () => staged[staged.length - 1],
    lastDirector: () => stagedDirector[stagedDirector.length - 1],
    lastCrossword: () => stagedCrossword[stagedCrossword.length - 1],
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
  initialCrossword,
  surface,
  onStage,
  onStageDirector,
  onStageCrossword,
  children,
}: {
  sceneId: string;
  initialState: ControlState;
  initialConfig: DirectorConfig;
  initialCrossword: CrosswordConfig;
  surface: SceneSurface;
  onStage: (over: Partial<ControlState>) => void;
  onStageDirector: (over: Partial<DirectorConfig>) => void;
  onStageCrossword: (over: Partial<CrosswordConfig>) => void;
  children: ReactNode;
}) {
  const [pending, setPending] = useState<Partial<ControlState>>({});
  const [pendingDirector, setPendingDirector] = useState<Partial<DirectorConfig>>({});
  const [pendingCrossword, setPendingCrossword] = useState<Partial<CrosswordConfig>>({});

  const value = useMemo<SceneDraftValue>(
    () => ({
      sceneId,
      surface,
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
      crossword: { ...initialCrossword, ...pendingCrossword },
      stageCrossword: (over) => {
        onStageCrossword(over);
        setPendingCrossword((prev) => ({ ...prev, ...over }));
      },
      pending,
      pendingDirector,
      pendingCrossword,
      dirty:
        Object.keys(pending).length > 0 ||
        Object.keys(pendingDirector).length > 0 ||
        Object.keys(pendingCrossword).length > 0,
      conflictKeys: [],
      saving: false,
      saveError: null,
      save: () => {},
      discard: () => {
        setPending({});
        setPendingDirector({});
        setPendingCrossword({});
      },
    }),
    [
      sceneId,
      surface,
      initialState,
      initialConfig,
      initialCrossword,
      pending,
      pendingDirector,
      pendingCrossword,
      onStage,
      onStageDirector,
      onStageCrossword,
    ],
  );

  return <SceneDraftContext.Provider value={value}>{children}</SceneDraftContext.Provider>;
}
