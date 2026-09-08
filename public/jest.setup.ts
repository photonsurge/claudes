import "@testing-library/jest-dom";

// jsdom's HTMLCanvasElement.getContext is a "not implemented" stub that logs a
// stack trace on every call. Every canvas here (labels, atmosphere, sub-globe,
// banner motion) tolerates a null context, so return that quietly. Suites that
// need a recording context still `jest.spyOn(HTMLCanvasElement.prototype,
// "getContext")` over this.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
}
