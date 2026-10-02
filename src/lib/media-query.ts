import { useMemo, useSyncExternalStore } from "react";

export interface MediaQueryStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): boolean;
  getServerSnapshot(): boolean;
}

/**
 * An external store over `window.matchMedia`, so components read a media query
 * during render instead of copying it into state from an effect. The server
 * snapshot is always false: React hydrates with the server value and then
 * re-renders with the real one, so the markup never mismatches.
 */
export function createMediaQueryStore(query: string): MediaQueryStore {
  return {
    subscribe(onChange) {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    getSnapshot: () => window.matchMedia(query).matches,
    getServerSnapshot: () => false,
  };
}

export function useMediaQuery(query: string): boolean {
  const store = useMemo(() => createMediaQueryStore(query), [query]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
