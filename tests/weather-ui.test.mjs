import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const itinerarySource = readFileSync(
  new URL("../src/components/ItineraryApp.jsx", import.meta.url),
  "utf8",
);
const todaySource = readFileSync(
  new URL("../src/components/itinerary/TodayConsole.jsx", import.meta.url),
  "utf8",
);

it("shows the weather advice source beside every clothing recommendation", () => {
  assert.match(itinerarySource, /weather\.adviceLabel/);
  assert.match(todaySource, /weather\?\.adviceLabel/);
  assert.match(itinerarySource, /季节穿衣参考/);
  assert.match(todaySource, /季节穿衣参考/);
});
