/**
 * MapLibre 6 draws with WebGL2. When the browser or device cannot create a
 * WebGL2 context, the Map constructor throws a GPUInitializationError (and
 * fires one as an "error" event if a lost context cannot be restored). The
 * map can never draw in that case, so the app shows a notice instead of
 * waiting for a map that will not load. The check uses the error's type name,
 * which survives bundling, rather than its wording or the user agent.
 */
export function isMapRendererUnavailable(error: unknown): boolean {
  return error instanceof Error && error.name === "GPUInitializationError";
}
