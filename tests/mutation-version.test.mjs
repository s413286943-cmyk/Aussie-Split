import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareMutationVersions,
  legacyMutationVersion,
  nextMutationVersion,
  parseMutationVersion,
} from "../src/lib/mutationVersion.js";

describe("mutation version parsing and ordering", () => {
  it("parses the fixed-width version fields", () => {
    assert.deepEqual(parseMutationVersion("1780000000000-000042-device-a"), {
      millis: 1780000000000,
      counter: 42,
      clientId: "device-a",
    });
  });

  it("rejects malformed and noncanonical versions", () => {
    const malformed = [
      "",
      "178000000000-000001-device-a",
      "1780000000000-00001-device-a",
      "1780000000000-000001-",
      "1780000000000-000001-Device-A",
      "1780000000000-000001-device--a",
      "1780000000000-000001-device/a",
    ];

    for (const value of malformed) {
      assert.throws(() => parseMutationVersion(value), /invalid mutation version/i);
    }
    assert.throws(() => parseMutationVersion(null), /invalid mutation version/i);
  });

  it("orders by millis, counter, then client id", () => {
    const versions = [
      "1780000000001-000000-client-a",
      "1780000000000-000002-client-a",
      "1780000000000-000001-client-b",
      "1780000000000-000001-client-a",
    ];

    assert.deepEqual([...versions].sort(compareMutationVersions), [...versions].sort());
    assert.equal(compareMutationVersions(versions[3], versions[3]), 0);
    assert.equal(compareMutationVersions(versions[3], versions[2]), -1);
    assert.equal(compareMutationVersions(versions[2], versions[1]), -1);
    assert.equal(compareMutationVersions(versions[1], versions[0]), -1);
  });
});

describe("nextMutationVersion", () => {
  it("starts at counter zero and normalizes the client id", () => {
    assert.equal(
      nextMutationVersion({ now: 1780000000000, clientId: " Device / A " }),
      "1780000000000-000000-device-a",
    );
  });

  it("advances beyond local and observed versions when the clock moves backward", () => {
    const previous = "1780000000100-000004-client-a";
    const observed = "1780000000100-000009-client-z";
    const next = nextMutationVersion({
      previous,
      observed,
      now: 1780000000000,
      clientId: "client-b",
    });

    assert.equal(next, "1780000000100-000010-client-b");
    assert.equal(compareMutationVersions(next, previous), 1);
    assert.equal(compareMutationVersions(next, observed), 1);
  });

  it("uses a newer physical time with a reset counter", () => {
    assert.equal(
      nextMutationVersion({
        previous: "1780000000000-000123-client-a",
        observed: "1779999999999-999999-client-z",
        now: 1780000000001,
        clientId: "client-b",
      }),
      "1780000000001-000000-client-b",
    );
  });

  it("carries an exhausted counter into the next millisecond", () => {
    assert.equal(
      nextMutationVersion({
        observed: "1780000000000-999999-client-z",
        now: 1779999999999,
        clientId: "client-a",
      }),
      "1780000000001-000000-client-a",
    );
  });

  it("rejects malformed high-water marks and unusable client ids", () => {
    assert.throws(
      () => nextMutationVersion({ previous: "not-a-version", now: 1780000000000, clientId: "client-a" }),
      /invalid mutation version/i,
    );
    assert.throws(
      () => nextMutationVersion({ observed: "not-a-version", now: 1780000000000, clientId: "client-a" }),
      /invalid mutation version/i,
    );
    assert.throws(
      () => nextMutationVersion({ now: 1780000000000, clientId: " / " }),
      /invalid client id/i,
    );
  });
});

describe("legacyMutationVersion", () => {
  it("uses a valid creation time and source index", () => {
    const createdAt = "2026-07-10T01:02:03.004Z";

    assert.equal(
      legacyMutationVersion({ createdAt, index: 12, clientId: " Imported Rows " }),
      `${Date.parse(createdAt)}-000012-imported-rows`,
    );
  });

  it("uses a deterministic valid fallback for an invalid creation time", () => {
    const first = legacyMutationVersion({ createdAt: "not-a-date", index: 7 });
    const second = legacyMutationVersion({ createdAt: "not-a-date", index: 7 });

    assert.equal(first, "0000000000000-000007-legacy");
    assert.equal(second, first);
    assert.deepEqual(parseMutationVersion(first), {
      millis: 0,
      counter: 7,
      clientId: "legacy",
    });
  });

  it("rejects an invalid source index", () => {
    assert.throws(
      () => legacyMutationVersion({ createdAt: "2026-07-10T01:02:03.004Z", index: -1 }),
      /invalid legacy index/i,
    );
  });
});
