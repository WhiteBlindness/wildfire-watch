import assert from "node:assert/strict";
import test from "node:test";
import { createMediaQueryStore } from "./media-query";

type Listener = () => void;

function installFakeMatchMedia(initialMatches: boolean) {
  const listeners = new Set<Listener>();
  const queries: string[] = [];
  const state = { matches: initialMatches };
  (globalThis as { window?: unknown }).window = {
    matchMedia(query: string) {
      queries.push(query);
      return {
        get matches() { return state.matches; },
        addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
        removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      };
    },
  };
  return {
    listeners,
    queries,
    change(next: boolean) {
      state.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

test("renders the server snapshot as false so hydration matches the server HTML", () => {
  installFakeMatchMedia(true);
  assert.equal(createMediaQueryStore("(max-width: 767px)").getServerSnapshot(), false);
});

test("reads the live media query on the client", () => {
  const media = installFakeMatchMedia(true);
  const store = createMediaQueryStore("(max-width: 767px)");
  assert.equal(store.getSnapshot(), true);
  media.change(false);
  assert.equal(store.getSnapshot(), false);
  assert.ok(media.queries.every((query) => query === "(max-width: 767px)"));
});

test("notifies subscribers on change and stops after unsubscribing", () => {
  const media = installFakeMatchMedia(false);
  const store = createMediaQueryStore("(max-width: 767px)");
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications += 1; });

  media.change(true);
  assert.equal(notifications, 1);

  unsubscribe();
  assert.equal(media.listeners.size, 0);
  media.change(false);
  assert.equal(notifications, 1);
});
