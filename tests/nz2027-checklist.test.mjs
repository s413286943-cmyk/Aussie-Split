import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  CHECKLIST_KEY,
  applyChecklistSnapshot,
  emptyChecklist,
  isDone,
  loadChecklist,
  pendingChecks,
  saveChecklist,
  setCheck,
} from "../src/lib/nz2027/checklist.js";
import { parseChecklistBatch } from "../src/lib/server/nz2027Checklist.js";
import { GET as getChecklist, POST as postChecklist } from "../src/app/api/nz2027/checklist/route.ts";
import { createSessionToken } from "../src/lib/server/session.js";

describe("2027 checklist store", () => {
  it("ticks and unticks, queueing each change until the server confirms it", () => {
    let state = setCheck(emptyChecklist(), "visa", true, new Date("2026-11-01T00:00:00Z"));
    assert.equal(isDone(state, "visa"), true);
    const sent = pendingChecks(state);

    state = setCheck(state, "visa", false, new Date("2026-11-01T00:00:01Z"));
    state = applyChecklistSnapshot(state, { sent, items: sent });
    assert.deepEqual(state.pendingIds, ["visa"], "changed again while the request was in flight");
    assert.equal(isDone(state, "visa"), false);

    const second = pendingChecks(state);
    state = applyChecklistSnapshot(state, { sent: second, items: second });
    assert.deepEqual(state.pendingIds, []);
  });

  it("takes the other phone's ticks for items not changed here", () => {
    const fromPartner = { id: "flight-syd", done: true, updatedAt: "2026-11-02T00:00:00.000Z" };
    const state = applyChecklistSnapshot(emptyChecklist(), { sent: [], items: [fromPartner, { id: "BAD ID", done: true, updatedAt: "x" }] });
    assert.equal(isDone(state, "flight-syd"), true);
    assert.equal(Object.keys(state.items).length, 1);
  });

  it("never moves a timestamp backwards and survives corrupt storage", () => {
    let state = setCheck(emptyChecklist(), "rippon", true, new Date("2026-11-05T00:00:00Z"));
    state = setCheck(state, "rippon", false, new Date("2026-11-01T00:00:00Z"));
    assert.ok(state.items.rippon.updatedAt > "2026-11-05T00:00:00.000Z");
    assert.throws(() => setCheck(emptyChecklist(), "Not Valid", true));

    const values = new Map();
    const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    storage.setItem(CHECKLIST_KEY, "{broken");
    assert.deepEqual(loadChecklist(storage), emptyChecklist());
    saveChecklist(storage, state);
    assert.deepEqual(loadChecklist(storage), state);
  });
});

describe("2027 checklist API", () => {
  const originalFetch = globalThis.fetch;
  const saved = {};
  beforeEach(() => {
    for (const key of ["TRIP_CODE", "SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) saved[key] = process.env[key];
    process.env.TRIP_CODE = "shared-code";
    process.env.SESSION_SECRET = "checklist-route-secret";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-secret";
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("requires the session and same-origin writes, and validates items", async () => {
    globalThis.fetch = async () => assert.fail("Supabase must not be called");
    assert.equal((await getChecklist(new Request("https://aussie.example/api/nz2027/checklist"))).status, 401);
    const crossSite = await postChecklist(authenticated({ method: "POST", headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }, body: "{}" }));
    assert.equal(crossSite.status, 403);
    assert.equal((await postChecklist(sameOrigin({ items: [{ id: "visa", done: "yes", updatedAt: "2026-11-01T00:00:00Z" }] }))).status, 400);
    assert.throws(() => parseChecklistBatch({ items: [item("visa"), item("visa")] }));
  });

  it("writes through the checklist RPC only", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push(String(url));
      if (String(url).includes("/rpc/nz2027_set_check")) {
        return Response.json({ id: JSON.parse(options.body).item.id, status: "applied" });
      }
      return Response.json([{ item_id: "visa", done: true, updated_at: "2026-11-01T00:00:00+00:00" }]);
    };
    const response = await postChecklist(sameOrigin({ items: [item("visa")] }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.results, [{ id: "visa", status: "applied" }]);
    assert.deepEqual(payload.items, [{ id: "visa", done: true, updatedAt: "2026-11-01T00:00:00.000Z" }]);
    assert.ok(calls.every((url) => /\/rest\/v1\/(rpc\/nz2027_set_check|nz2027_checklist\?)/.test(url)));
  });
});

function item(id) {
  return { id, done: true, updatedAt: "2026-11-01T00:00:00.000Z" };
}

function authenticated(init = {}) {
  const token = createSessionToken(process.env.SESSION_SECRET);
  return new Request("https://aussie.example/api/nz2027/checklist", { ...init, headers: { Cookie: `aussie_chill_session=${token}`, ...(init.headers || {}) } });
}

function sameOrigin(body) {
  return authenticated({
    method: "POST",
    headers: { Origin: "https://aussie.example", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
