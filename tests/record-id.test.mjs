import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

let importError;
const recordId = await import("../src/lib/recordId.js").catch((error) => {
  importError = error;
  return {};
});

describe("collision-resistant browser record ids", () => {
  it("creates distinct prefixed ids without relying on the current clock", () => {
    assert.equal(typeof recordId.createRecordId, "function", importError?.message);
    const values = ["uuid-one", "uuid-two"];
    const randomUUID = () => values.shift();

    assert.equal(recordId.createRecordId("expense", randomUUID), "expense-uuid-one");
    assert.equal(recordId.createRecordId("expense", randomUUID), "expense-uuid-two");
  });

  it("uses UUID-backed identities for expense and activity creation", () => {
    const formSource = readFileSync(new URL("../src/components/ledger/ExpenseForm.jsx", import.meta.url), "utf8");
    const activitySource = readFileSync(new URL("../src/lib/activity.js", import.meta.url), "utf8");
    const ledgerSource = readFileSync(new URL("../src/lib/ledger.js", import.meta.url), "utf8");

    assert.match(formSource, /createRecordId\("expense"/);
    assert.doesNotMatch(formSource, /expense-\$\{Date\.now\(\)\}/);
    assert.match(activitySource, /createRecordId\("activity"/);
    assert.doesNotMatch(activitySource, /activity-\$\{createdAt\}/);
    assert.match(ledgerSource, /createRecordId\("draft"/);
    assert.doesNotMatch(ledgerSource, /draft-\$\{Date\.now\(\)\}/);
  });
});
