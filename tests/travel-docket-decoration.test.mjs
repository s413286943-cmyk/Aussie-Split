import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const routeStyles = readFileSync(new URL("../src/styles/route-atlas.css", import.meta.url), "utf8");
const docketStyles = readFileSync(new URL("../src/styles/docket.css", import.meta.url), "utf8");
const styles = `${docketStyles}\n${routeStyles}`;
const desktopStart = routeStyles.lastIndexOf("@media (min-width: 1100px)");
const desktopEnd = routeStyles.indexOf("@media (max-width: 960px)", desktopStart);
const desktopRouteStyles = routeStyles.slice(desktopStart, desktopEnd);

describe("travel docket decoration hierarchy", () => {
  it("removes fixed viewport ornaments from the ledger and itinerary", () => {
    assert.doesNotMatch(styles, /\.docket-shell::before\s*\{/);
    assert.doesNotMatch(styles, /\.route-atlas::after\s*\{/);
  });

  it("keeps semantic status lines inside itinerary cards", () => {
    assert.match(
      docketStyles,
      /\.day-card::before\s*\{[\s\S]*?width:\s*5px;[\s\S]*?background:\s*var\(--accent\);/,
    );
    assert.match(
      docketStyles,
      /\.weather-strip\s*\{[\s\S]*?border-left-color:\s*var\(--sun\);/,
    );
  });

  it("gives an open itinerary day a clear semantic focus", () => {
    assert.match(
      routeStyles,
      /\.route-day-card details\[open\]\s*\{[\s\S]*?border-left:\s*4px solid var\(--atlas-coast\);[\s\S]*?background:\s*rgba\(13,\s*108,\s*115,\s*0\.06\);/,
    );
    assert.match(
      routeStyles,
      /\.route-day-card details\[open\]\s*>\s*summary\s*\{[\s\S]*?border-bottom:\s*1px solid rgba\(13,\s*108,\s*115,\s*0\.16\);/,
    );
  });

  it("uses the expanded desktop width for a calmer timeline", () => {
    assert.match(
      desktopRouteStyles,
      /\.day-grid \.route-day-card:has\(details\[open\]\) \.time-block\s*\{[\s\S]*?grid-template-columns:\s*104px minmax\(0,\s*1fr\);[\s\S]*?gap:\s*18px;/,
    );
  });
});
