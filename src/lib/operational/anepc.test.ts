import assert from "node:assert/strict";
import test from "node:test";
import { AnepcFeedError, buildAnepcQueryUrl, mapAnepcPhase, parseAnepcOccurrences } from "./anepc";

const NOW = Date.parse("2026-08-12T15:00:00Z");
const HOUR = 3_600_000;

/** One ArcGIS feature as the occurrences layer returns it with f=json and outSR=4326. */
function feature(attributes: Record<string, unknown>, geometry: { x: number; y: number } | null = { x: -8.05, y: 40.22 }) {
  return {
    attributes: {
      Numero: "2026080012345",
      ID_oc: 501,
      EstadoAgrupado: "Em Curso",
      CodNatureza: "3101",
      Natureza: "Incêndio Rural - Povoamento Florestal",
      DataOcorrencia: NOW - 3 * HOUR,
      DataDosDados: NOW - 10 * 60_000,
      Concelho: "Arganil",
      Freguesia: "Pomares",
      Endereco: "Rua X, n.º 1",
      Operacionais: 84,
      MeiosTerrestres: 25,
      MeiosAereos: 2,
      ...attributes,
    },
    ...(geometry ? { geometry } : {}),
  };
}

function body(features: unknown[], extra: Record<string, unknown> = {}) {
  return { objectIdFieldName: "OBJECTID", features, ...extra };
}

test("the query asks the occurrences layer for every field, in WGS 84, as JSON", () => {
  const url = new URL(buildAnepcQueryUrl());
  assert.equal(url.protocol, "https:");
  assert.match(url.pathname, /\/FeatureServer\/0\/query$/);
  assert.equal(url.searchParams.get("where"), "1=1");
  assert.equal(url.searchParams.get("outFields"), "*");
  assert.equal(url.searchParams.get("outSR"), "4326");
  assert.equal(url.searchParams.get("f"), "json");
});

test("a rural-fire occurrence becomes an operational incident with reported fields only", () => {
  const result = parseAnepcOccurrences(body([feature({})]), NOW);
  assert.equal(result.incidents.length, 1);
  const [incident] = result.incidents;
  assert.deepEqual(incident, {
    kind: "operational_incident",
    id: "anepc:2026080012345",
    datasetId: "anepc:ocorrencias-em-aberto",
    sourceId: "2026080012345",
    location: { lat: 40.22, lng: -8.05 },
    phase: "in_progress",
    phaseLabel: "Em Curso",
    natureCode: "3101",
    natureLabel: "Incêndio Rural - Povoamento Florestal",
    startedAt: new Date(NOW - 3 * HOUR).toISOString(),
    updatedAt: new Date(NOW - 10 * 60_000).toISOString(),
    municipality: "Arganil",
    parish: "Pomares",
    resources: { personnel: 84, groundVehicles: 25, aircraft: 2 },
  });
  assert.equal(JSON.stringify(incident).includes("Rua X"), false, "street addresses are not kept");
  assert.deepEqual(result.counts, { sourceRows: 1, filteredRows: 1, selectedPoints: 1 });
});

test("only rural fires are kept; mop-up consolidation, fuel management and debris burning are not wildfires", () => {
  const result = parseAnepcOccurrences(body([
    feature({ Numero: "1", CodNatureza: "3101" }),
    feature({ Numero: "2", CodNatureza: 3103 }),
    feature({ Numero: "3", CodNatureza: "3107" }),
    feature({ Numero: "4", CodNatureza: "3109" }),
    feature({ Numero: "5", CodNatureza: "3111" }),
    feature({ Numero: "6", CodNatureza: "2101", Natureza: "Acidente - Colisão" }),
    feature({ Numero: "7", CodNatureza: undefined, Natureza: "3105 - Agrícola" }),
  ]), NOW);
  assert.deepEqual(result.incidents.map((incident) => incident.sourceId).sort(), ["1", "2", "7"]);
  assert.equal(result.incidents.find((incident) => incident.sourceId === "7")?.natureCode, "3105");
  assert.deepEqual(result.counts, { sourceRows: 7, filteredRows: 3, selectedPoints: 3 });
});

test("phases map the source's own labels, and an unknown label is kept verbatim and reported", () => {
  assert.equal(mapAnepcPhase("Em Despacho"), "dispatch");
  assert.equal(mapAnepcPhase("Despacho de 1.º Alerta"), "dispatch");
  assert.equal(mapAnepcPhase("Em Curso"), "in_progress");
  assert.equal(mapAnepcPhase("EM RESOLUÇÃO"), "resolving");
  assert.equal(mapAnepcPhase("Em Resolucao"), "resolving");
  assert.equal(mapAnepcPhase("Em Conclusão"), "concluding");
  assert.equal(mapAnepcPhase("Vigilância"), "surveillance");
  assert.equal(mapAnepcPhase("Chegada ao TO"), "other");

  const result = parseAnepcOccurrences(body([
    feature({ Numero: "1", EstadoAgrupado: "Chegada ao TO" }),
    feature({ Numero: "2", EstadoAgrupado: "Encerrada" }),
  ]), NOW);
  assert.deepEqual(result.incidents.map((incident) => [incident.sourceId, incident.phase, incident.phaseLabel]), [["1", "other", "Chegada ao TO"]]);
  assert.deepEqual(result.quality.unrecognisedPhases, ["Chegada ao TO"]);
});

test("coordinates come from the geometry, else from the attributes, and must be in mainland Portugal", () => {
  const result = parseAnepcOccurrences(body([
    feature({ Numero: "geometry" }),
    feature({ Numero: "attributes", Latitude: "39,5", Longitude: -8.1 }, null),
    feature({ Numero: "madeira" }, { x: -16.9, y: 32.65 }),
    feature({ Numero: "nowhere" }, null),
  ]), NOW);
  assert.deepEqual(result.incidents.map((incident) => [incident.sourceId, incident.location]).sort(), [
    ["attributes", { lat: 39.5, lng: -8.1 }],
    ["geometry", { lat: 40.22, lng: -8.05 }],
  ]);
  assert.equal(result.quality.invalidRecords, 2);
});

test("records without a usable identifier, phase or start time are dropped and counted", () => {
  const result = parseAnepcOccurrences(body([
    feature({ Numero: "ok" }),
    feature({ Numero: undefined, ID_oc: undefined }),
    feature({ Numero: "no-phase", EstadoAgrupado: undefined, EstadoOcorrencia: undefined }),
    feature({ Numero: "no-date", DataOcorrencia: "ontem" }),
    feature({ Numero: "future", DataOcorrencia: NOW + 3 * HOUR }),
  ]), NOW);
  assert.deepEqual(result.incidents.map((incident) => incident.sourceId), ["ok"]);
  assert.equal(result.quality.invalidRecords, 4);
});

test("resource counts must be whole non-negative numbers; anything else is unknown, not zero", () => {
  const [incident] = parseAnepcOccurrences(body([feature({ Operacionais: -3, MeiosTerrestres: "12", MeiosAereos: null })]), NOW).incidents;
  assert.deepEqual(incident.resources, { personnel: null, groundVehicles: 12, aircraft: null });
});

test("a duplicated occurrence keeps its most recently published state", () => {
  const result = parseAnepcOccurrences(body([
    feature({ EstadoAgrupado: "Em Curso", DataDosDados: NOW - 30 * 60_000 }),
    feature({ EstadoAgrupado: "Em Resolução", DataDosDados: NOW - 5 * 60_000 }),
  ]), NOW);
  assert.equal(result.incidents.length, 1);
  assert.equal(result.incidents[0].phase, "resolving");
  assert.equal(result.quality.duplicateRecords, 1);
});

test("incidents are ordered newest first, then by identifier, so snapshots are reproducible", () => {
  const result = parseAnepcOccurrences(body([
    feature({ Numero: "b", DataOcorrencia: NOW - 2 * HOUR }),
    feature({ Numero: "a", DataOcorrencia: NOW - 2 * HOUR }),
    feature({ Numero: "c", DataOcorrencia: NOW - HOUR }),
  ]), NOW);
  assert.deepEqual(result.incidents.map((incident) => incident.sourceId), ["c", "a", "b"]);
});

test("an empty list is valid: no open rural fires", () => {
  const result = parseAnepcOccurrences(body([]), NOW);
  assert.deepEqual(result.incidents, []);
  assert.deepEqual(result.counts, { sourceRows: 0, filteredRows: 0, selectedPoints: 0 });
});

test("a truncated response is flagged", () => {
  assert.equal(parseAnepcOccurrences(body([feature({})], { exceededTransferLimit: true }), NOW).quality.truncated, true);
});

test("an ArcGIS error body or a changed schema fails the run instead of publishing nothing", () => {
  assert.throws(() => parseAnepcOccurrences({ error: { code: 400, message: "Invalid query" } }, NOW), (error: unknown) => error instanceof AnepcFeedError && error.code === "http_error");
  assert.throws(() => parseAnepcOccurrences({ features: "nope" }, NOW), (error: unknown) => error instanceof AnepcFeedError && error.code === "parse_error");
  // Fields renamed upstream: rows arrive, but none has a nature code any more.
  const renamed = body([{ attributes: { NumeroOcorrencia: "1", Estado: "Em Curso" } }, { attributes: { NumeroOcorrencia: "2" } }]);
  assert.throws(() => parseAnepcOccurrences(renamed, NOW), (error: unknown) => error instanceof AnepcFeedError && error.code === "parse_error");
  // Rural fires arrive but none is usable.
  const unusable = body([feature({ Numero: undefined, ID_oc: undefined }), feature({ Numero: undefined, ID_oc: undefined })]);
  assert.throws(() => parseAnepcOccurrences(unusable, NOW), (error: unknown) => error instanceof AnepcFeedError && error.code === "parse_error");
});
