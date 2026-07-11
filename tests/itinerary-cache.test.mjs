import assert from "node:assert/strict";
import { describe, it } from "node:test";

let importError;
const itineraryCache = await import("../src/lib/itineraryCache.js").catch((error) => {
  importError = error;
  return {};
});

describe("private itinerary offline cache", () => {
  it("round-trips a valid protected itinerary without exposing a public fallback", () => {
    assert.equal(typeof itineraryCache.writeCachedItinerary, "function", importError?.message);
    assert.equal(typeof itineraryCache.readCachedItinerary, "function", importError?.message);
    const storage = memoryStorage();
    const itinerary = {
      trip: { title: "Private trip" },
      stages: [{ id: "stage-one", dayIds: ["d0"] }],
      days: [{ id: "d0", label: "D0" }],
    };

    itineraryCache.writeCachedItinerary(storage, itinerary);

    assert.deepEqual(itineraryCache.readCachedItinerary(storage), itinerary);
  });

  it("ignores corrupt or incomplete cached content", () => {
    assert.equal(typeof itineraryCache.readCachedItinerary, "function", importError?.message);
    assert.equal(itineraryCache.readCachedItinerary(memoryStorage({ value: "{not-json" })), null);
    assert.equal(itineraryCache.readCachedItinerary(memoryStorage({ value: JSON.stringify({ trip: {} }) })), null);
  });
});

function memoryStorage({ value = null } = {}) {
  let stored = value;
  return {
    getItem() {
      return stored;
    },
    setItem(_key, next) {
      stored = String(next);
    },
  };
}
