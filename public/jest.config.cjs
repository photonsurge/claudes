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
  transform: {
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
    "^maplibre-gl$": "<rootDir>/src/test/mocks/maplibre-gl.ts",
    "^@deck.gl/core$": "<rootDir>/src/test/mocks/deckgl.ts",
    "^@deck.gl/layers$": "<rootDir>/src/test/mocks/deckgl.ts",
    "^@deck.gl/mapbox$": "<rootDir>/src/test/mocks/deckgl.ts",
    "^@deck.gl/geo-layers$": "<rootDir>/src/test/mocks/geolayers.ts",
    "^weatherlayers-gl$": "<rootDir>/src/test/mocks/weatherlayers.ts",
    "^@loaders.gl/core$": "<rootDir>/src/test/mocks/loaders.ts",
  },
};
