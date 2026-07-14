import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const routeStyles = readFileSync(new URL("../src/styles/route-atlas.css", import.meta.url), "utf8");
const docketStyles = readFileSync(new URL("../src/styles/docket.css", import.meta.url), "utf8");

describe("itinerary day-card layout", () => {
  it("lets an expanded desktop day own the full grid row", () => {
    assert.match(
      routeStyles,
      /@media\s*\(min-width:\s*1100px\)[\s\S]*?\.day-grid\s+\.route-day-card:has\(details\[open\]\)\s*\{\s*grid-column:\s*1\s*\/\s*-1;/,
    );
  });

  it("keeps the mobile itinerary in one column", () => {
    assert.match(
      docketStyles,
      /@media\s*\(max-width:\s*900px\)[\s\S]*?\.day-grid,[\s\S]*?\.final-day\s*\{\s*grid-template-columns:\s*1fr;/,
    );
  });
});
