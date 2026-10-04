/**
 * Plan-written test for `yarn seed:crossword-scene` (docs/crossword-mode-plan.md
 * §10): it creates the channel record only — surface `crossword`, music bed
 * on, chat on, no YouTube channel. No Mongo: the app db is a recording fake,
 * and any other db call (a crossword config, a puzzle, a slot) fails the test.
 */
jest.mock("../loadEnv", () => ({ loadWorkerEnv: jest.fn() }));

const calls: { method: string; args: unknown[] }[] = [];
let existing: Record<string, unknown> | null = null;

jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: jest.fn(async () => {
    const known: Record<string, unknown> = {
      getScene: async (...args: unknown[]) => {
        calls.push({ method: "getScene", args });
        return existing;
      },
      createScene: async (...args: unknown[]) => {
        calls.push({ method: "createScene", args });
        return { id: args[0] };
      },
      conn: { close: async () => undefined },
    };
    return new Proxy(known, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        if (prop === "then") return undefined;
        // Anything else the script touches is recorded as a call it should not make.
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return undefined;
        };
      },
    });
  }),
}));

async function runScript(argv: string[] = []): Promise<number> {
  const argvWas = process.argv;
  process.argv = ["node", "crosswordSeedScene.ts", ...argv];
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((r) => (resolveExit = r));
  const exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
    resolveExit(code ?? 0);
    return undefined as never;
  }) as any);
  const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    jest.isolateModules(() => {
      require("./crosswordSeedScene");
    });
    return await exited;
  } finally {
    process.argv = argvWas;
    exitSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  }
}

beforeEach(() => {
  calls.length = 0;
  existing = null;
});

describe("seed:crossword-scene (§10)", () => {
  it("creates the channel record: surface crossword, music bed on, chat on, no YouTube channel", async () => {
    const code = await runScript();
    expect(code).toBe(0);
    const creates = calls.filter((c) => c.method === "createScene");
    expect(creates).toHaveLength(1);
    const [id, name, state, opts] = creates[0].args as [string, string, any, any];
    expect(id).toBe("crossword");
    expect(typeof name).toBe("string");
    expect(opts).toMatchObject({ surface: "crossword" });
    expect(state.audio.enabled).toBe(true);
    expect(state.chat.enabled).toBe(true);
    expect(state.youtube?.accountId ?? "").toBe("");
  });

  it("creates the channel record only: no crossword config, puzzle or other record", async () => {
    await runScript();
    const others = calls.filter((c) => c.method !== "getScene" && c.method !== "createScene").map((c) => c.method);
    expect(others).toEqual([]);
  });

  it("takes an id from the command line", async () => {
    await runScript(["puzzle-two", "Puzzle Two"]);
    const create = calls.find((c) => c.method === "createScene")!;
    expect(create.args[0]).toBe("puzzle-two");
    expect(create.args[1]).toBe("Puzzle Two");
  });

  it("leaves an existing channel alone", async () => {
    existing = { id: "crossword", surface: "crossword" };
    const code = await runScript();
    expect(code).toBe(0);
    expect(calls.filter((c) => c.method === "createScene")).toHaveLength(0);
  });
});
