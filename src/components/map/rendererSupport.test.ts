import assert from "node:assert/strict";
import test from "node:test";
import { isMapRendererUnavailable } from "./rendererSupport";

class GPUInitializationError extends Error {
  constructor() {
    super("WebGL2 is required to display this map.");
    this.name = "GPUInitializationError";
  }
}

test("MapLibre's GPU initialisation failure means the map cannot be drawn on this device", () => {
  assert.equal(isMapRendererUnavailable(new GPUInitializationError()), true);
});

test("other map errors leave the renderer available", () => {
  const tileError = Object.assign(new Error("Failed to fetch"), { name: "AJAXError" });
  assert.equal(isMapRendererUnavailable(tileError), false);
  assert.equal(isMapRendererUnavailable(new TypeError("style is not valid")), false);
  assert.equal(isMapRendererUnavailable(new Error("WebGL2 is required")), false, "only the error type counts, not its wording");
  assert.equal(isMapRendererUnavailable(null), false);
  assert.equal(isMapRendererUnavailable("GPUInitializationError"), false);
});
