import type { CachedFirmsPoint } from "@/lib/wildfire/firms-cache";

/**
 * Full-resolution detections fetched for one selected fire. The points are
 * keyed by the selection they were fetched for, so a response can never be
 * drawn at a different fire's location.
 */
export interface DetailState {
  selectionId: string | null;
  points: CachedFirmsPoint[] | null;
}

export const EMPTY_DETAIL_STATE: DetailState = { selectionId: null, points: null };

/**
 * The state that applies to the current selection: the same object while the
 * selection is unchanged (so callers can compare by identity), and an empty
 * state for the new selection as soon as it changes.
 */
export function detailStateForSelection(state: DetailState, selectionId: string | null): DetailState {
  return state.selectionId === selectionId ? state : { selectionId, points: null };
}

/** Records fetched points only if they still belong to the active selection. */
export function withDetailPoints(state: DetailState, selectionId: string, points: CachedFirmsPoint[]): DetailState {
  return state.selectionId === selectionId ? { selectionId, points } : state;
}
