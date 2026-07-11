import assert from "node:assert/strict";
import { it } from "node:test";

import itinerary from "../src/data/itinerary.generated.json" with { type: "json" };
import { readWorkbook } from "../scripts/import-itinerary.mjs";

it("keeps generated itinerary JSON identical to the Excel source", () => {
  assert.deepEqual(
    itinerary,
    readWorkbook(),
    "Itinerary JSON is stale; run npm run itinerary:import",
  );
});
