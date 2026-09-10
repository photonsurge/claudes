/** Jest config for the public web app.
 *
 * jsdom environment for RTL component tests; ts-jest for TS/TSX. WebGL-bound
 * modules (maplibre-gl, deck.gl, weatherlayers-gl, @loaders.gl) are mapped to
 * lightweight manual mocks so tests never touch a real GL context.
 */
module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // node_modules stays untransformed (ts-jest only compiles our sources).
  transform: {
    "^.+\\.js$": ["ts-jest", { tsconfig: { allowJs: true, module: "commonjs", esModuleInterop: true, target: "ES2021" }, diagnostics: false }],
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          module: "commonjs",
          moduleResolution: "node",
          target: "ES2021",
          lib: ["dom", "dom.iterable", "esnext"],
          skipLibCheck: true,
          strict: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    // Server-only logger; the real module loads mongoose (untransformed ESM
    // bson), so stub it for the many pure-logic suites that reach it via
    // lib/api-log (e.g. lib/focus/focus-cache).
    "^@photonsurge/shared/utill/BackLogger$": "<rootDir>/src/test/mocks/backlogger.ts",
    // Web Worker factory (uses import.meta.url — not parseable as CommonJS);
    // the stub returns null so SubGlobeWidget paints on the main thread.
    "subglobe-worker-client$": "<rootDir>/src/test/mocks/subglobe-worker-client.ts",
    // Same story for the texture decode worker pool: the stub returns null so
    // textures.ts uses the (mocked) WeatherLayers loader in tests.
    "texture-decode-client$": "<rootDir>/src/test/mocks/texture-decode-client.ts",
    "high-low-client$": "<rootDir>/src/test/mocks/high-low-client.ts",
    "label-declutter-client$": "<rootDir>/src/test/mocks/label-declutter-client.ts",
    "^maplibre-gl$": "<rootDir>/src/test/mocks/maplibre-gl.ts",
    "^@deck.gl/core$": "<rootDir>/src/test/mocks/deckgl.ts",
    "^@deck.gl/layers$": "<rootDir>/src/test/mocks/deckgl.ts",
    "^@deck.gl/mapbox$": "<rootDir>/src/test/mocks/deckgl.ts",
    "^@deck.gl/extensions$": "<rootDir>/src/test/mocks/deckgl.ts",
    "^@luma.gl/core$": "<rootDir>/src/test/mocks/luma.ts",
    "^@deck.gl/geo-layers$": "<rootDir>/src/test/mocks/geolayers.ts",
    "^weatherlayers-gl$": "<rootDir>/src/test/mocks/weatherlayers.ts",
    "^@loaders.gl/core$": "<rootDir>/src/test/mocks/loaders.ts",
  },
};
