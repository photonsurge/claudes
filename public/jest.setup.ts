import "@testing-library/jest-dom";

// jsdom's HTMLCanvasElement.getContext is a "not implemented" stub that logs a
// stack trace on every call. Every canvas here (labels, atmosphere, sub-globe,
// banner motion) tolerates a null context, so return that quietly. Suites that
// need a recording context still `jest.spyOn(HTMLCanvasElement.prototype,
// "getContext")` over this.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
}

// jsdom ships no ResizeObserver, and the on-air chrome measures itself with one
// (FittedColumn re-fits the right-hand column as its cards change height). A
// no-op stand-in is right for these tests: jsdom reports every element as 0×0,
// so nothing would ever resize — without it the component throws on mount and
// takes whole suites down with it. Tests asserting on measured layout install
// their own mock over this.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
