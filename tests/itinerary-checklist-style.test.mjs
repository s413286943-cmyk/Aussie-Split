import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const styles = readFileSync(new URL("../src/styles/route-atlas.css", import.meta.url), "utf8");
const mobileStart = styles.lastIndexOf("@media (max-width: 720px)");
const mobileEnd = styles.indexOf("@media (max-width: 480px)", mobileStart);
const baseStyles = styles.slice(0, mobileStart);
const mobileStyles = styles.slice(mobileStart, mobileEnd);

describe("itinerary daily field kit", () => {
  it("keeps the checklist and ledger paired on desktop", () => {
    assert.match(
      baseStyles,
      /\.today-field-kit\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*0\.9fr\) minmax\(0,\s*1\.1fr\);/,
    );
    assert.match(baseStyles, /\.carry-checklist\s*\{[\s\S]*?border-right:/);
  });

  it("keeps the checkbox compact at every breakpoint", () => {
    assert.match(
      baseStyles,
      /\.carry-check-item input\[type="checkbox"\]\s*\{[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;[\s\S]*?min-height:\s*18px;/,
    );
  });

  it("uses one consistent title and detail hierarchy", () => {
    assert.match(baseStyles, /\.carry-check-item\s*\{[\s\S]*?grid-template-columns:\s*18px minmax\(0,\s*1fr\);/);
    assert.match(baseStyles, /\.carry-check-item strong\s*\{[\s\S]*?font-size:\s*0\.875rem;/);
    assert.match(baseStyles, /\.carry-check-item small\s*\{[\s\S]*?font-size:\s*0\.75rem;/);
  });

  it("groups ledger metrics and actions into compact desktop grids", () => {
    assert.match(
      baseStyles,
      /\.ledger-dock-metrics\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.35fr\) repeat\(2,\s*minmax\(0,\s*0\.8fr\)\);/,
    );
    assert.match(baseStyles, /\.ledger-dock-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  });

  it("stacks the field kit and reflows ledger content on mobile", () => {
    assert.match(mobileStyles, /\.today-field-kit\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
    assert.match(
      mobileStyles,
      /\.ledger-dock-metrics\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    );
    assert.match(
      mobileStyles,
      /\.ledger-dock-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    );
  });
});
