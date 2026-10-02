import assert from "node:assert/strict";
import test from "node:test";
import type { CachedFirmsPoint } from "@/lib/wildfire/firms-cache";
import { EMPTY_DETAIL_STATE, detailStateForSelection, withDetailPoints } from "./detailState";

function point(id: string): CachedFirmsPoint {
  return { id, lat: 39.5, lng: -8.1, frpMw: 12, confidencePct: 80, detectedAt: "2026-08-01T12:00:00.000Z" };
}

test("keeps the same state object while the selection does not change", () => {
  const loaded = withDetailPoints(detailStateForSelection(EMPTY_DETAIL_STATE, "fire-a"), "fire-a", [point("a1")]);
  assert.equal(detailStateForSelection(loaded, "fire-a"), loaded);
  assert.equal(detailStateForSelection(EMPTY_DETAIL_STATE, null), EMPTY_DETAIL_STATE);
});

test("drops the previous fire's dense pixels the moment the selection changes", () => {
  const loaded = withDetailPoints(detailStateForSelection(EMPTY_DETAIL_STATE, "fire-a"), "fire-a", [point("a1")]);
  assert.deepEqual(detailStateForSelection(loaded, "fire-b"), { selectionId: "fire-b", points: null });
  assert.deepEqual(detailStateForSelection(loaded, null), { selectionId: null, points: null });
});

test("clears a reused selection id after the selection was dismissed", () => {
  // Cluster ids come from MapLibre and can repeat for a different cluster once
  // the selection has been cleared in between.
  const loaded = withDetailPoints(detailStateForSelection(EMPTY_DETAIL_STATE, "cluster-5"), "cluster-5", [point("old")]);
  const dismissed = detailStateForSelection(loaded, null);
  assert.deepEqual(detailStateForSelection(dismissed, "cluster-5"), { selectionId: "cluster-5", points: null });
});

test("ignores a response that arrives after the selection moved on", () => {
  const onB = detailStateForSelection(EMPTY_DETAIL_STATE, "fire-b");
  assert.equal(withDetailPoints(onB, "fire-a", [point("late")]), onB);
  assert.deepEqual(withDetailPoints(onB, "fire-b", [point("b1")]).points?.map((item) => item.id), ["b1"]);
});
