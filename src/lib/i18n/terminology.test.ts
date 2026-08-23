import { test } from "node:test";
import assert from "node:assert/strict";
import en from "./en";
import pt from "./pt";

// Guards the honesty fix: an individual FIRMS VIIRS NRT hotspot carries no
// source-type attribution (the NRT feed has no `type` column), so the default
// per-detection label must describe what the satellite actually observed — a
// thermal detection — and must never assert it is definitively an active or
// vegetation fire.

test("default detection classification states a satellite thermal detection, not a definitive fire", () => {
  assert.equal(en.fireDetail.classificationThermalDetection, "Satellite thermal detection");
  assert.equal(pt.fireDetail.classificationThermalDetection, "Deteção térmica por satélite");
});

test("the per-detection classification label does not claim a definitive active/vegetation fire", () => {
  const definitiveFire = /active fire|vegetation fire|inc[eê]ndio ativ|fogo ativ/i;
  assert.doesNotMatch(en.fireDetail.classificationThermalDetection, definitiveFire);
  assert.doesNotMatch(pt.fireDetail.classificationThermalDetection, definitiveFire);
});

test("European Portuguese spelling: deteção, not detecção", () => {
  assert.match(pt.fireDetail.classificationThermalDetection, /Deteção/);
  assert.doesNotMatch(pt.fireDetail.classificationThermalDetection, /Detecção/);
});
