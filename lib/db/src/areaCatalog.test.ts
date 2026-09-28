import assert from "node:assert/strict";
import test from "node:test";
import { MCO_TERMINAL_AREAS } from "./areaCatalog";

test("MCO terminal catalog matches the 43 workbook operating areas", () => {
  assert.equal(MCO_TERMINAL_AREAS.length, 43);

  const counts = MCO_TERMINAL_AREAS.reduce<Record<string, number>>(
    (result, area) => {
      result[area.terminal] = (result[area.terminal] ?? 0) + 1;
      return result;
    },
    {},
  );
  assert.deepEqual(counts, {
    "Terminal A - East": 9,
    "Terminal A - West": 6,
    "Terminal B - East": 6,
    "Terminal B - West": 8,
    "Terminal C": 6,
    "Top Terminal": 8,
  });
});

test("MCO terminal catalog has stable ordering and no ambiguous identities", () => {
  const canonicalKeys = new Set<string>();
  const legacyKeys = new Map<string, string>();

  MCO_TERMINAL_AREAS.forEach((area, index) => {
    assert.equal(area.sortOrder, index + 1);
    assert.ok(area.coverage.length > 0);

    const canonicalKey = `${area.terminal}::${area.name}`;
    assert.equal(
      canonicalKeys.has(canonicalKey),
      false,
      `duplicate canonical area ${canonicalKey}`,
    );
    canonicalKeys.add(canonicalKey);

    for (const legacyName of area.legacyNames) {
      const legacyKey = `${area.terminal}::${legacyName}`;
      const existing = legacyKeys.get(legacyKey);
      assert.ok(
        !existing || existing === canonicalKey,
        `${legacyKey} maps to both ${existing} and ${canonicalKey}`,
      );
      legacyKeys.set(legacyKey, canonicalKey);
    }
  });
});

test("workbook-specific coverage is retained", () => {
  const terminalC3 = MCO_TERMINAL_AREAS.find(
    (area) =>
      area.terminal === "Terminal C" && area.name === "Group 1 — Level 3 (C3)",
  );
  assert.equal(terminalC3?.coverage, "Rows C59–C69");
  assert.match(
    terminalC3?.additionalCoverage ?? "",
    /Small Escalator Levels 3–4/,
  );

  const topLevel11 = MCO_TERMINAL_AREAS.find(
    (area) => area.terminal === "Top Terminal" && area.name === "Level 11",
  );
  assert.equal(
    topLevel11?.coverage,
    "Side A: Heliport / Rooftop; Side B: Heliport / Rooftop",
  );
});
