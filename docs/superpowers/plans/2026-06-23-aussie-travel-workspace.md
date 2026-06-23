# Aussie Travel Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared, fully editable Australia trip workspace around the existing split-bill app, with traveler-facing navigation, Supabase-backed trip content, live weather where available, and ledger wording that uses "孙张" and "胡董".

**Architecture:** Keep the current Next.js app and lightweight Supabase REST approach. Split the current monolithic app into a shared app shell, focused travel views, focused ledger views, seed data, store helpers, and small pure functions that can be tested with Node's built-in test runner. Use local browser storage as the fallback cache and Supabase as the shared source when configured.

**Tech Stack:** Next.js App Router, React client components, plain JavaScript modules, Supabase REST, browser localStorage, Open-Meteo forecast API, Node `node:test`, ESLint, existing CSS.

---

## Scope Check

This is one cohesive feature because the travel guide, shared editing, weather, and ledger labels all share the same authenticated trip shell. The work is still large, so the implementation should land in small commits. Each task below must leave the app runnable and the tests passing.

## File Structure

- Create `src/lib/couples.js`: single source for couple ids, display labels, and settlement wording.
- Modify `src/lib/ledger.js`: keep existing payer ids (`us`, `them`) for compatibility, but expose traveler-facing labels through `couples.js`.
- Create `src/lib/travelSeed.js`: structured seed content for D0-D16, lodging, booking, budget, food, and activity items.
- Create `tests/travelSeed.test.mjs`: verifies the supplied itinerary has been seeded as editable structured content.
- Create `src/lib/travelStore.js`: load/save helpers for travel days and list items, with local fallback and Supabase REST.
- Create `tests/travelStore.test.mjs`: verifies row mapping and local fallback helpers without making network calls.
- Create `src/lib/weather.js`: forecast URL building, forecast availability logic, and traveler-facing clothing advice.
- Create `tests/weather.test.mjs`: deterministic tests for forecast range and clothing advice.
- Create `src/components/UnlockGate.jsx`: access-code gate shared by all pages.
- Create `src/components/AppShell.jsx`: header, traveler-facing nav, and sync/save status display.
- Create `src/components/TravelWorkspace.jsx`: "今日", "行程", and "清单" views.
- Create `src/components/LedgerWorkspace.jsx`: existing ledger behavior with traveler-facing couple labels.
- Modify `src/components/TripLedgerApp.jsx`: either remove it after replacement or turn it into a small compatibility wrapper.
- Modify route files in `src/app`: map routes to the new shell and views.
- Modify `src/app/globals.css`: add only the styles needed for travel cards, forms, and the new ledger area.
- Modify `supabase/schema.sql`: add shared travel tables and seed rows.
- Modify `README.md`: explain the expanded trip workspace and Supabase setup in user-facing setup language.

## Data Contracts

Use these shapes in app code. They are intentionally small and editable.

```js
export const travelDay = {
  id: "d8",
  dayIndex: 8,
  date: "2026-08-05",
  weekday: "周三",
  city: "丹翠雨林",
  title: "丹翠雨林 + Cape Tribulation 小团一日游",
  focus: "交给当地司机和向导，专心看热带雨林、鳄鱼河道和雨林入海。",
  lodging: "Southern Cross Atrium Apartments",
  climateNote: "凯恩斯约 17-26°C，旱季，阳光充足。",
  clothingNote: "短袖、泳装、防晒衣、墨镜、帽子、薄外套；车上和室内空调可能冷。",
  backupNote: "晚餐简单，不再加夜间项目。",
  blocks: [
    {
      id: "d8-early",
      period: "清晨",
      place: "凯恩斯酒店 → 丹翠方向",
      activity: "6:55am 酒店门口集合，跟团车北上",
      highlight: "不用自驾，沿途可休息看风景",
      tip: "早上提前吃一点，带水、防晒、帽子和薄外套"
    }
  ]
};

export const tripItem = {
  id: "booking-reef-magic",
  kind: "booking",
  title: "大堡礁外礁一日游",
  relatedDayId: "d7",
  city: "凯恩斯",
  status: "还没订",
  amount: 5400,
  currency: "CNY",
  note: "优先 Reef Magic Outer Reef Pontoon；确认是否含午餐、浮潜装备、半潜艇、玻璃底船、海底观景室。",
  link: "",
  sortOrder: 20
};
```

Allowed `tripItem.kind` values:

```js
["lodging", "booking", "budget", "food", "activity"]
```

Allowed `tripItem.status` values:

```js
["已订好", "还没订", "到时再看"]
```

Supabase tables should store `blocks` as `jsonb` on each day. This keeps day edits simple and avoids a large join layer for the first implementation.

---

### Task 1: Couple Labels And Ledger Language Foundation

**Files:**
- Create: `src/lib/couples.js`
- Modify: `src/lib/ledger.js`
- Modify: `tests/ledger.test.mjs`

- [ ] **Step 1: Add failing tests for couple labels**

Append these tests to `tests/ledger.test.mjs`:

```js
import {
  coupleName,
  formatPayerLabel,
  formatSettlementDirection,
} from "../src/lib/couples.js";
```

Add these cases inside the existing `describe("travel split ledger", () => { ... })` block:

```js
  it("uses traveler-facing couple names", () => {
    assert.equal(coupleName("us"), "孙张");
    assert.equal(coupleName("them"), "胡董");
    assert.equal(formatPayerLabel("us"), "孙张付款");
    assert.equal(formatPayerLabel("them"), "胡董付款");
  });

  it("formats settlement direction with couple names", () => {
    assert.equal(formatSettlementDirection(120), "胡董还需给孙张");
    assert.equal(formatSettlementDirection(-80), "孙张还需给胡董");
    assert.equal(formatSettlementDirection(0), "两边已结清");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because `src/lib/couples.js` does not exist.

- [ ] **Step 3: Create the couple label module**

Create `src/lib/couples.js`:

```js
export const couples = [
  { id: "us", shortName: "孙张", fullName: "孙晟 / 张心怡" },
  { id: "them", shortName: "胡董", fullName: "胡锦康 / 董瑞欣" },
];

export function coupleName(id) {
  return couples.find((couple) => couple.id === id)?.shortName || id;
}

export function formatPayerLabel(id) {
  return `${coupleName(id)}付款`;
}

export function formatSettlementDirection(netOtherOwesUs) {
  if (netOtherOwesUs > 0) return "胡董还需给孙张";
  if (netOtherOwesUs < 0) return "孙张还需给胡董";
  return "两边已结清";
}
```

- [ ] **Step 4: Update existing member names**

In `src/lib/ledger.js`, replace the current `members` export with:

```js
import { couples } from "./couples.js";

export const members = couples.map((couple) => ({
  id: couple.id,
  name: couple.shortName,
}));
```

Keep `payer` values as `"us"` and `"them"` so existing stored expenses remain compatible.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected: PASS, including the new couple label tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/couples.js src/lib/ledger.js tests/ledger.test.mjs
git commit -m "Add couple labels for ledger"
```

---

### Task 2: Structured Travel Seed Data

**Files:**
- Create: `src/lib/travelSeed.js`
- Create: `tests/travelSeed.test.mjs`

- [ ] **Step 1: Add seed data tests**

Create `tests/travelSeed.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  initialTravelDays,
  initialTripItems,
  listSections,
  tripItemStatuses,
} from "../src/lib/travelSeed.js";

describe("travel workspace seed data", () => {
  it("seeds D0 through D16 as editable days", () => {
    assert.equal(initialTravelDays.length, 17);
    assert.deepEqual(initialTravelDays.map((day) => day.id), [
      "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8",
      "d9", "d10", "d11", "d12", "d13", "d14", "d15", "d16",
    ]);
    assert.equal(initialTravelDays[0].date, "2026-07-28");
    assert.equal(initialTravelDays[16].date, "2026-08-13");
  });

  it("keeps daily content structured instead of one long text blob", () => {
    const d8 = initialTravelDays.find((day) => day.id === "d8");
    assert.equal(d8.city, "丹翠雨林");
    assert.match(d8.title, /Cape Tribulation/);
    assert.ok(Array.isArray(d8.blocks));
    assert.ok(d8.blocks.length >= 5);
    assert.ok(d8.blocks.every((block) => block.id && block.period && block.activity));
  });

  it("seeds lodging, booking, budget, food, and activity list sections", () => {
    assert.deepEqual(listSections.map((section) => section.kind), [
      "lodging",
      "booking",
      "budget",
      "food",
      "activity",
    ]);
    for (const kind of listSections.map((section) => section.kind)) {
      assert.ok(initialTripItems.some((item) => item.kind === kind), `missing ${kind}`);
    }
  });

  it("uses only traveler-facing item statuses", () => {
    assert.deepEqual(tripItemStatuses, ["已订好", "还没订", "到时再看"]);
    assert.ok(initialTripItems.every((item) => tripItemStatuses.includes(item.status)));
  });

  it("includes key supplied guide details", () => {
    assert.ok(initialTripItems.some((item) => item.title.includes("Cafe Sydney")));
    assert.ok(initialTripItems.some((item) => item.title.includes("Reef Magic")));
    assert.ok(initialTripItems.some((item) => item.title.includes("Oaks Sydney Goldsbrough")));
    assert.ok(initialTripItems.some((item) => item.title.includes("Prawn Star")));
    assert.ok(initialTripItems.some((item) => item.title.includes("大洋路租车")));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because `src/lib/travelSeed.js` does not exist.

- [ ] **Step 3: Create the seed module skeleton and constants**

Create `src/lib/travelSeed.js` with:

```js
export const tripItemStatuses = ["已订好", "还没订", "到时再看"];

export const listSections = [
  { kind: "lodging", title: "住哪里" },
  { kind: "booking", title: "还要订什么" },
  { kind: "budget", title: "预算心里有数" },
  { kind: "food", title: "想吃什么" },
  { kind: "activity", title: "活动和门票" },
];

export const initialTravelDays = [
  day("d0", 0, "2026-07-28", "周二", "上海 → 香港 → 墨尔本", "出发日", "香港转机 1h35m，夜航飞墨尔本。", "飞机上", "长途飞行，注意休息。", "飞机上和机场空调冷，带薄外套。", [
    block("d0-flight", "全天", "上海 → 香港 → 墨尔本", "出发，香港转机后夜航飞墨尔本", "旅程开始", "随身带证件、充电线、薄外套")
  ]),
  day("d1", 1, "2026-07-29", "周三", "墨尔本", "抵达墨尔本", "恢复日，不硬玩。", "Oaks Melbourne on Market Hotel", "墨尔本冬季约 6-14°C，早晚冷，多风，偶有阵雨。", "羽绒服或防风外套、毛衣、长裤、防水鞋。", [
    block("d1-morning", "早上", "墨尔本机场 → CBD", "入境、取行李，打车或 SkyBus 进城", "初到澳洲，适应气候", "4 人同行和行李较多时，打车或 Uber 更舒服"),
    block("d1-breakfast", "上午", "CBD", "咖啡早餐，酒店寄存行李", "墨尔本咖啡文化开场", "不要急着开始暴走"),
    block("d1-rest", "下午", "酒店", "入住、补觉、洗澡", "调整时差", "这是保证后面自驾状态的关键"),
    block("d1-river", "傍晚", "Southbank / Yarra River", "河边散步", "墨尔本夜景、城市氛围", "轻松走走即可"),
    block("d1-dinner", "晚上", "Southbank", "河畔晚餐", "冬日城市感", "可看 Riverland Bar、Ponyfish Island 或 Southbank 河边餐厅")
  ]),
];

export const initialTripItems = [
  item("lodging-oaks-melbourne", "lodging", "Oaks Melbourne on Market Hotel", "d1", "墨尔本", "已订好", 2534.86, "CNY", "60 Market St, Melbourne, VIC 3000；D1-D2 两晚。", "", 10),
  item("booking-great-ocean-car", "booking", "大洋路租车", "d3", "墨尔本", "还没订", 11500, "CNY", "建议 Kia Carnival / 8座 MPV；确认保险、第二驾驶人、异地还车费、toll。", "", 20),
  item("booking-reef-magic", "booking", "Reef Magic 大堡礁外礁一日游", "d7", "凯恩斯", "还没订", 5400, "CNY", "优先外礁平台；确认午餐、浮潜装备、半潜艇、玻璃底船、海底观景室、取消政策。", "", 30),
  item("food-prawn-star", "food", "Prawn Star Cairns", "d7", "凯恩斯", "到时再看", 0, "", "Marlin Marina 上的 floating seafood restaurant，适合 D7 或 D10 晚餐。", "", 40),
  item("food-cafe-sydney", "food", "Cafe Sydney 告别晚餐", "d15", "悉尼", "还没订", 4000, "CNY", "建议 18:00-19:00，确认主餐厅、露台或靠窗位，注意 dress code 和 surcharge。", "", 50),
  item("budget-total", "budget", "当前较精确执行预算", "", "全程", "到时再看", 128035, "CNY", "4 人合计约 ¥128,035，人均约 ¥32,009。", "", 60),
  item("activity-whale", "activity", "悉尼出海观鲸", "d14", "悉尼", "已订好", 340.2, "AUD", "Captain Cook Whale Watching；提前吃晕船药，穿防风外套。", "", 70),
];

function day(id, dayIndex, date, weekday, city, title, focus, lodging, climateNote, clothingNote, blocks, backupNote = "") {
  return { id, dayIndex, date, weekday, city, title, focus, lodging, climateNote, clothingNote, blocks, backupNote };
}

function block(id, period, place, activity, highlight, tip) {
  return { id, period, place, activity, highlight, tip };
}

function item(id, kind, title, relatedDayId, city, status, amount, currency, note, link, sortOrder) {
  return { id, kind, title, relatedDayId, city, status, amount, currency, note, link, sortOrder };
}
```

- [ ] **Step 4: Complete all D0-D16 days**

Replace the short `initialTravelDays` array from Step 3 with structured objects for all days from `/Users/SeanSun/.codex/attachments/ec7d6ea2-3b05-4d1f-8b78-aab9b2aeedb1/pasted-text.txt`.

Use these exact day ids and dates:

```js
[
  ["d0", 0, "2026-07-28", "周二"],
  ["d1", 1, "2026-07-29", "周三"],
  ["d2", 2, "2026-07-30", "周四"],
  ["d3", 3, "2026-07-31", "周五"],
  ["d4", 4, "2026-08-01", "周六"],
  ["d5", 5, "2026-08-02", "周日"],
  ["d6", 6, "2026-08-03", "周一"],
  ["d7", 7, "2026-08-04", "周二"],
  ["d8", 8, "2026-08-05", "周三"],
  ["d9", 9, "2026-08-06", "周四"],
  ["d10", 10, "2026-08-07", "周五"],
  ["d11", 11, "2026-08-08", "周六"],
  ["d12", 12, "2026-08-09", "周日"],
  ["d13", 13, "2026-08-10", "周一"],
  ["d14", 14, "2026-08-11", "周二"],
  ["d15", 15, "2026-08-12", "周三"],
  ["d16", 16, "2026-08-13", "周四"],
]
```

For D13, put both Blue Mountains and Grand Pacific Drive options into `backupNote` as readable text and keep the main title as `"悉尼弹性一日游"`.

- [ ] **Step 5: Complete list items**

Expand `initialTripItems` so it includes:

- All six confirmed lodging entries from the supplied "已确认住宿" section.
- The budget summary rows: 住宿, 国际机票, 澳洲国内机票, 租车与交通, 门票活动, 普通餐饮, Cafe Sydney, 杂项, 总计.
- Main activity cost references: Reef Magic, Daintree tour, whale watching, Opera House tour, Grand Pacific Drive, Blue Mountains Scenic World.
- Must-book items 1 through 12 from the supplied "需要提前预订的项目" section.
- All food-map rows from the supplied "美食地图" section.

Keep each item short enough to scan in a card. Long guide paragraphs should go into `note`, not into `title`.

- [ ] **Step 6: Run seed tests**

Run:

```bash
npm test
```

Expected: PASS for `travelSeed.test.mjs` and existing ledger tests.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/lib/travelSeed.js tests/travelSeed.test.mjs
git commit -m "Seed editable travel workspace content"
```

---

### Task 3: Supabase Travel Tables And Row Mapping

**Files:**
- Modify: `supabase/schema.sql`
- Create: `src/lib/travelStore.js`
- Create: `tests/travelStore.test.mjs`

- [ ] **Step 1: Add row mapping tests**

Create `tests/travelStore.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dayFromRow,
  dayToRow,
  itemFromRow,
  itemToRow,
  mergeTravelData,
} from "../src/lib/travelStore.js";

describe("travel store mapping", () => {
  it("maps editable days to Supabase rows and back", () => {
    const day = {
      id: "d8",
      dayIndex: 8,
      date: "2026-08-05",
      weekday: "周三",
      city: "丹翠雨林",
      title: "丹翠雨林 + Cape Tribulation",
      focus: "雨林入海",
      lodging: "Southern Cross Atrium Apartments",
      climateNote: "17-26°C",
      clothingNote: "薄外套",
      backupNote: "简单晚餐",
      blocks: [{ id: "d8-early", period: "清晨", place: "酒店", activity: "集合", highlight: "省心", tip: "带水" }],
    };

    const row = dayToRow(day);
    assert.equal(row.id, "d8");
    assert.equal(row.day_index, 8);
    assert.deepEqual(row.blocks, day.blocks);
    assert.deepEqual(dayFromRow(row), day);
  });

  it("maps list items to Supabase rows and back", () => {
    const item = {
      id: "food-cafe-sydney",
      kind: "food",
      title: "Cafe Sydney",
      relatedDayId: "d15",
      city: "悉尼",
      status: "还没订",
      amount: 4000,
      currency: "CNY",
      note: "告别晚餐",
      link: "",
      sortOrder: 50,
    };

    const row = itemToRow(item);
    assert.equal(row.related_day_id, "d15");
    assert.equal(row.sort_order, 50);
    assert.deepEqual(itemFromRow(row), item);
  });

  it("uses remote content when available and seed content otherwise", () => {
    const seed = { days: [{ id: "d1", title: "seed" }], items: [{ id: "x", title: "seed" }] };
    assert.deepEqual(mergeTravelData(seed, { days: [], items: [] }), seed);
    assert.deepEqual(mergeTravelData(seed, { days: [{ id: "d1", title: "remote" }], items: [] }), {
      days: [{ id: "d1", title: "remote" }],
      items: seed.items,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because `src/lib/travelStore.js` does not exist.

- [ ] **Step 3: Implement row mapping helpers**

Create `src/lib/travelStore.js`:

```js
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const travelSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const travelStorageKey = "aussie-chill-travel-v1";

export function dayToRow(day) {
  return {
    id: day.id,
    day_index: day.dayIndex,
    date: day.date,
    weekday: day.weekday,
    city: day.city,
    title: day.title,
    focus: day.focus,
    lodging: day.lodging,
    climate_note: day.climateNote,
    clothing_note: day.clothingNote,
    backup_note: day.backupNote || "",
    blocks: day.blocks || [],
  };
}

export function dayFromRow(row) {
  return {
    id: row.id,
    dayIndex: Number(row.day_index),
    date: row.date,
    weekday: row.weekday,
    city: row.city,
    title: row.title,
    focus: row.focus,
    lodging: row.lodging || "",
    climateNote: row.climate_note || "",
    clothingNote: row.clothing_note || "",
    backupNote: row.backup_note || "",
    blocks: row.blocks || [],
  };
}

export function itemToRow(item) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    related_day_id: item.relatedDayId || "",
    city: item.city || "",
    status: item.status,
    amount: item.amount || 0,
    currency: item.currency || "",
    note: item.note || "",
    link: item.link || "",
    sort_order: item.sortOrder || 0,
  };
}

export function itemFromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    relatedDayId: row.related_day_id || "",
    city: row.city || "",
    status: row.status,
    amount: Number(row.amount || 0),
    currency: row.currency || "",
    note: row.note || "",
    link: row.link || "",
    sortOrder: Number(row.sort_order || 0),
  };
}

export function mergeTravelData(seed, remote) {
  return {
    days: remote?.days?.length ? remote.days : seed.days,
    items: remote?.items?.length ? remote.items : seed.items,
  };
}

function authHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}
```

- [ ] **Step 4: Add Supabase fetch and save helpers**

Append to `src/lib/travelStore.js`:

```js
export async function fetchRemoteTravelData() {
  if (!travelSupabaseConfigured) return null;

  const [daysResponse, itemsResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/travel_days?select=*&order=day_index.asc`, { headers: authHeaders() }),
    fetch(`${SUPABASE_URL}/rest/v1/trip_items?select=*&order=sort_order.asc`, { headers: authHeaders() }),
  ]);

  if (!daysResponse.ok || !itemsResponse.ok) {
    throw new Error("Unable to load travel workspace");
  }

  return {
    days: (await daysResponse.json()).map(dayFromRow),
    items: (await itemsResponse.json()).map(itemFromRow),
  };
}

export async function saveRemoteDay(day) {
  if (!travelSupabaseConfigured) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/travel_days`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(dayToRow(day)),
  });

  if (!response.ok) throw new Error("Unable to save travel day");
}

export async function saveRemoteItem(item) {
  if (!travelSupabaseConfigured) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/trip_items`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(itemToRow(item)),
  });

  if (!response.ok) throw new Error("Unable to save trip item");
}

export async function deleteRemoteItem(id) {
  if (!travelSupabaseConfigured) return;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/trip_items?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!response.ok) throw new Error("Unable to delete trip item");
}
```

- [ ] **Step 5: Add schema tables**

Append to `supabase/schema.sql` before the final storage comment:

```sql
create table if not exists public.travel_days (
  id text primary key,
  day_index integer not null unique,
  date date not null,
  weekday text not null,
  city text not null,
  title text not null,
  focus text not null default '',
  lodging text not null default '',
  climate_note text not null default '',
  clothing_note text not null default '',
  backup_note text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_items (
  id text primary key,
  kind text not null check (kind in ('lodging', 'booking', 'budget', 'food', 'activity')),
  title text not null,
  related_day_id text not null default '',
  city text not null default '',
  status text not null check (status in ('已订好', '还没订', '到时再看')),
  amount numeric(12, 2) not null default 0,
  currency text not null default '',
  note text not null default '',
  link text not null default '',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
```

Do not hand-write all seed inserts into SQL. The app will seed first-run content through `travelSeed.js` and can save edited rows through the REST helpers.

- [ ] **Step 6: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add supabase/schema.sql src/lib/travelStore.js tests/travelStore.test.mjs
git commit -m "Add travel workspace storage mapping"
```

---

### Task 4: Weather Forecast Helpers

**Files:**
- Create: `src/lib/weather.js`
- Create: `tests/weather.test.mjs`

- [ ] **Step 1: Add weather tests**

Create `tests/weather.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildForecastUrl,
  forecastCanCoverDate,
  getWeatherPlace,
  makeClothingAdvice,
} from "../src/lib/weather.js";

describe("weather helpers", () => {
  it("maps trip cities to forecast places", () => {
    assert.equal(getWeatherPlace("凯恩斯").name, "Cairns");
    assert.equal(getWeatherPlace("丹翠雨林").name, "Daintree");
    assert.equal(getWeatherPlace("悉尼弹性一日游").name, "Sydney");
  });

  it("builds an Open-Meteo forecast URL without an API key", () => {
    const url = buildForecastUrl(getWeatherPlace("悉尼"), "2026-08-09", "2026-08-09");
    const params = new URL(url).searchParams;
    assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    assert.equal(params.get("daily"), "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max");
    assert.equal(params.get("timezone"), "Australia/Sydney");
  });

  it("only treats near-term forecasts as live", () => {
    assert.equal(forecastCanCoverDate("2026-07-20", "2026-07-28"), true);
    assert.equal(forecastCanCoverDate("2026-06-23", "2026-07-28"), false);
  });

  it("creates traveler-facing clothing advice", () => {
    assert.equal(
      makeClothingAdvice({ maxTemp: 13, rainMm: 2, windKph: 38, uvIndex: 2 }, "海边风大"),
      "偏冷又有风，穿防风外套；可能下雨，鞋子尽量防水。海边风大",
    );
    assert.equal(
      makeClothingAdvice({ maxTemp: 27, rainMm: 0, windKph: 12, uvIndex: 8 }, "船舱空调可能冷"),
      "白天热，注意防晒；紫外线强，带帽子和墨镜。船舱空调可能冷",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because `src/lib/weather.js` does not exist.

- [ ] **Step 3: Implement weather helpers**

Create `src/lib/weather.js`:

```js
const places = [
  { match: /墨尔本|Apollo Bay|Port Campbell|大洋路/i, name: "Melbourne", latitude: -37.8136, longitude: 144.9631, timezone: "Australia/Melbourne" },
  { match: /凯恩斯/i, name: "Cairns", latitude: -16.9186, longitude: 145.7781, timezone: "Australia/Brisbane" },
  { match: /丹翠|Daintree|Cape Tribulation/i, name: "Daintree", latitude: -16.2500, longitude: 145.3200, timezone: "Australia/Brisbane" },
  { match: /阿瑟顿|Atherton/i, name: "Atherton", latitude: -17.2686, longitude: 145.4752, timezone: "Australia/Brisbane" },
  { match: /蓝山|Katoomba/i, name: "Blue Mountains", latitude: -33.7125, longitude: 150.3119, timezone: "Australia/Sydney" },
  { match: /南海岸|Kiama|Wollongong|Grand Pacific/i, name: "Kiama", latitude: -34.6680, longitude: 150.8527, timezone: "Australia/Sydney" },
  { match: /悉尼|Sydney|Bondi|Manly/i, name: "Sydney", latitude: -33.8688, longitude: 151.2093, timezone: "Australia/Sydney" },
];

export function getWeatherPlace(city) {
  return places.find((place) => place.match.test(city)) || places[0];
}

export function buildForecastUrl(place, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max",
    timezone: place.timezone,
    start_date: startDate,
    end_date: endDate,
  });

  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function forecastCanCoverDate(todayIso, targetIso) {
  const today = new Date(`${todayIso}T00:00:00Z`);
  const target = new Date(`${targetIso}T00:00:00Z`);
  const diffDays = Math.floor((target - today) / 86400000);
  return diffDays >= 0 && diffDays <= 16;
}

export function makeClothingAdvice(weather, manualNote = "") {
  const parts = [];

  if (weather.maxTemp <= 14) parts.push("偏冷");
  else if (weather.maxTemp >= 26) parts.push("白天热");
  else parts.push("温度舒服");

  if (weather.windKph >= 30) parts[0] = `${parts[0]}又有风`;
  if (weather.maxTemp <= 14 || weather.windKph >= 30) parts.push("穿防风外套");
  if (weather.rainMm > 0) parts.push("可能下雨，鞋子尽量防水");
  if (weather.uvIndex >= 7) parts.push("紫外线强，带帽子和墨镜");

  const sentence = `${parts.join("；")}。`;
  return manualNote ? `${sentence}${manualNote}` : sentence;
}
```

- [ ] **Step 4: Add browser fetch helper**

Append to `src/lib/weather.js`:

```js
export async function fetchDayWeather(day, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!forecastCanCoverDate(todayIso, day.date)) return null;

  const place = getWeatherPlace(day.city);
  const response = await fetch(buildForecastUrl(place, day.date, day.date));
  if (!response.ok) throw new Error("Unable to load weather");

  const data = await response.json();
  return {
    place: place.name,
    maxTemp: Number(data.daily.temperature_2m_max[0]),
    minTemp: Number(data.daily.temperature_2m_min[0]),
    rainMm: Number(data.daily.precipitation_sum[0]),
    windKph: Number(data.daily.wind_speed_10m_max[0]),
    uvIndex: Number(data.daily.uv_index_max[0]),
  };
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/weather.js tests/weather.test.mjs
git commit -m "Add travel weather helpers"
```

---

### Task 5: App Shell, Access Gate, And Routes

**Files:**
- Create: `src/components/UnlockGate.jsx`
- Create: `src/components/AppShell.jsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/itinerary/page.tsx`
- Create: `src/app/lists/page.tsx`
- Create: `src/app/ledger/page.tsx`
- Create: `src/app/ledger/add/page.tsx`
- Create: `src/app/ledger/expenses/page.tsx`
- Create: `src/app/ledger/settlement/page.tsx`
- Modify: `src/app/add/page.tsx`
- Modify: `src/app/expenses/page.tsx`
- Modify: `src/app/settlement/page.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the access gate**

Create `src/components/UnlockGate.jsx`:

```jsx
"use client";

import { useEffect, useState } from "react";

const accessKey = "aussie-chill-access-v1";
const defaultTripCode = process.env.NEXT_PUBLIC_TRIP_CODE || "aussie";

export default function UnlockGate({ children }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setUnlocked(localStorage.getItem(accessKey) === "yes");
    setReady(true);
  }, []);

  function submit(event) {
    event.preventDefault();
    if (code.trim() === defaultTripCode) {
      localStorage.setItem(accessKey, "yes");
      setUnlocked(true);
      return;
    }
    setError("访问码不对");
  }

  if (!ready) return <main className="unlock-wrap" />;
  if (unlocked) return children;

  return (
    <main className="unlock-wrap">
      <section className="unlock-card stack">
        <h1>Aussie Chill</h1>
        <p className="muted">输入旅行访问码后进入共享行程和账本。</p>
        <form className="stack" onSubmit={submit}>
          <label>
            访问码
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="aussie" />
          </label>
          {error && <p className="muted">{error}</p>}
          <button className="button primary" type="submit">进入旅行</button>
        </form>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Create the shared app shell**

Create `src/components/AppShell.jsx`:

```jsx
"use client";

import Link from "next/link";

import UnlockGate from "./UnlockGate";

const navItems = [
  { view: "today", href: "/", label: "今日" },
  { view: "itinerary", href: "/itinerary", label: "行程" },
  { view: "lists", href: "/lists", label: "清单" },
  { view: "ledger", href: "/ledger", label: "账本" },
];

export default function AppShell({ view, children, status = "" }) {
  return (
    <UnlockGate>
      <div className="app-shell">
        <header className="hero">
          <div>
            <p className="eyebrow">2026.07.28-08.13</p>
            <h1>Aussie Chill</h1>
            <p>南十字星下的十六日。上海出发，墨尔本进，悉尼出。</p>
          </div>
          {status && <span className="button">{status}</span>}
        </header>

        {children}

        <nav className="nav" aria-label="主导航">
          {navItems.map((item) => (
            <Link className={view === item.view ? "active" : ""} href={item.href} key={item.view}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </UnlockGate>
  );
}
```

- [ ] **Step 3: Add route files**

Set `src/app/page.tsx`:

```tsx
import TravelWorkspace from "@/components/TravelWorkspace";

export default function Home() {
  return <TravelWorkspace view="today" />;
}
```

Create `src/app/itinerary/page.tsx`:

```tsx
import TravelWorkspace from "@/components/TravelWorkspace";

export default function ItineraryPage() {
  return <TravelWorkspace view="itinerary" />;
}
```

Create `src/app/lists/page.tsx`:

```tsx
import TravelWorkspace from "@/components/TravelWorkspace";

export default function ListsPage() {
  return <TravelWorkspace view="lists" />;
}
```

Create `src/app/ledger/page.tsx`:

```tsx
import LedgerWorkspace from "@/components/LedgerWorkspace";

export default function LedgerPage() {
  return <LedgerWorkspace view="dashboard" />;
}
```

Create `src/app/ledger/add/page.tsx`:

```tsx
import LedgerWorkspace from "@/components/LedgerWorkspace";

export default function LedgerAddPage() {
  return <LedgerWorkspace view="add" />;
}
```

Create `src/app/ledger/expenses/page.tsx`:

```tsx
import LedgerWorkspace from "@/components/LedgerWorkspace";

export default function LedgerExpensesPage() {
  return <LedgerWorkspace view="expenses" />;
}
```

Create `src/app/ledger/settlement/page.tsx`:

```tsx
import LedgerWorkspace from "@/components/LedgerWorkspace";

export default function LedgerSettlementPage() {
  return <LedgerWorkspace view="settlement" />;
}
```

- [ ] **Step 4: Keep old ledger links working**

Set `src/app/add/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function AddPage() {
  redirect("/ledger/add");
}
```

Set `src/app/expenses/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function ExpensesPage() {
  redirect("/ledger/expenses");
}
```

Set `src/app/settlement/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function SettlementPage() {
  redirect("/ledger/settlement");
}
```

- [ ] **Step 5: Update metadata**

In `src/app/layout.tsx`, set:

```ts
export const metadata: Metadata = {
  title: "Aussie Chill",
  description: "澳洲旅行共享行程和 split bill 账本",
};
```

- [ ] **Step 6: Add temporary placeholder components so routes compile**

Create `src/components/TravelWorkspace.jsx`:

```jsx
"use client";

import AppShell from "./AppShell";

export default function TravelWorkspace({ view }) {
  return (
    <AppShell view={view}>
      <section className="section card">
        <h2>{view === "today" ? "今日" : view === "itinerary" ? "行程" : "清单"}</h2>
        <p className="muted">旅行内容正在准备中。</p>
      </section>
    </AppShell>
  );
}
```

Create `src/components/LedgerWorkspace.jsx` by copying the current `TripLedgerApp.jsx` contents, then:

- Rename the default function to `LedgerWorkspace`.
- Import `AppShell` from `"./AppShell"`.
- Remove the old `Unlock` component and old hero/nav wrapper.
- Wrap ledger content in `<AppShell view="ledger" status={syncState}>...</AppShell>`.

- [ ] **Step 7: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected: both complete successfully. The local build may print the existing macOS SWC warning and continue with webpack.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/app src/components/UnlockGate.jsx src/components/AppShell.jsx src/components/TravelWorkspace.jsx src/components/LedgerWorkspace.jsx src/app/layout.tsx
git commit -m "Add travel workspace shell"
```

---

### Task 6: Editable Travel Workspace UI

**Files:**
- Modify: `src/components/TravelWorkspace.jsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Implement loading and local fallback state**

Replace `src/components/TravelWorkspace.jsx` with a component that:

- Starts from `initialTravelDays` and `initialTripItems`.
- Reads `travelStorageKey` from localStorage.
- Calls `fetchRemoteTravelData()`.
- Uses `mergeTravelData()`.
- Saves current data back to localStorage after edits.

Use this structure:

```jsx
"use client";

import { useEffect, useMemo, useState } from "react";

import { initialTravelDays, initialTripItems, listSections, tripItemStatuses } from "@/lib/travelSeed";
import {
  fetchRemoteTravelData,
  mergeTravelData,
  saveRemoteDay,
  saveRemoteItem,
  deleteRemoteItem,
  travelStorageKey,
} from "@/lib/travelStore";
import { fetchDayWeather, makeClothingAdvice } from "@/lib/weather";

import AppShell from "./AppShell";

const seed = { days: initialTravelDays, items: initialTripItems };

export default function TravelWorkspace({ view }) {
  const [days, setDays] = useState(initialTravelDays);
  const [items, setItems] = useState(initialTripItems);
  const [status, setStatus] = useState("本机已准备");
  const [weatherByDay, setWeatherByDay] = useState({});

  useEffect(() => {
    const saved = localStorage.getItem(travelStorageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      setDays(parsed.days || initialTravelDays);
      setItems(parsed.items || initialTripItems);
      setStatus("显示上次保存的内容");
    }

    fetchRemoteTravelData()
      .then((remote) => {
        const merged = mergeTravelData(seed, remote);
        setDays(merged.days);
        setItems(merged.items);
        localStorage.setItem(travelStorageKey, JSON.stringify(merged));
        setStatus(remote ? "已保存" : "本机已准备");
      })
      .catch(() => setStatus("现在先显示上次保存的内容"));
  }, []);

  const today = useMemo(() => pickToday(days), [days]);

  async function persist(nextDays, nextItems, remoteAction) {
    setDays(nextDays);
    setItems(nextItems);
    localStorage.setItem(travelStorageKey, JSON.stringify({ days: nextDays, items: nextItems }));
    setStatus("正在保存");
    try {
      await remoteAction?.();
      setStatus("已保存");
    } catch {
      setStatus("现在先显示上次保存的内容");
    }
  }

  async function updateDay(day) {
    const nextDays = days.map((item) => (item.id === day.id ? day : item));
    await persist(nextDays, items, () => saveRemoteDay(day));
  }

  async function updateItem(item) {
    const nextItems = items.map((entry) => (entry.id === item.id ? item : entry));
    await persist(days, nextItems, () => saveRemoteItem(item));
  }

  async function addItem(kind) {
    const section = listSections.find((entry) => entry.kind === kind);
    const item = {
      id: `${kind}-${Date.now()}`,
      kind,
      title: `新的${section.title}`,
      relatedDayId: "",
      city: "",
      status: "还没订",
      amount: 0,
      currency: "",
      note: "",
      link: "",
      sortOrder: items.length + 1,
    };
    await persist(days, [...items, item], () => saveRemoteItem(item));
  }

  async function removeItem(id) {
    if (!window.confirm("确定删除这一条吗？")) return;
    await persist(days, items.filter((item) => item.id !== id), () => deleteRemoteItem(id));
  }

  useEffect(() => {
    if (!today) return;
    fetchDayWeather(today)
      .then((weather) => {
        if (weather) setWeatherByDay((current) => ({ ...current, [today.id]: weather }));
      })
      .catch(() => {});
  }, [today]);

  return (
    <AppShell view={view} status={status}>
      {view === "today" && <TodayView day={today} items={items} weather={weatherByDay[today?.id]} onChangeDay={updateDay} />}
      {view === "itinerary" && <ItineraryView days={days} items={items} weatherByDay={weatherByDay} onChangeDay={updateDay} />}
      {view === "lists" && <ListsView items={items} onChangeItem={updateItem} onAddItem={addItem} onDeleteItem={removeItem} />}
    </AppShell>
  );
}

function pickToday(days) {
  const todayIso = new Date().toISOString().slice(0, 10);
  return days.find((day) => day.date >= todayIso) || days.at(-1);
}
```

- [ ] **Step 2: Add day editor helpers**

In the same file, add `Field`, `TextAreaField`, `EditableBlock`, and `DayEditor` components. The inputs must use traveler-facing labels:

```jsx
function Field({ label, value, onChange }) {
  return (
    <label>
      {label}
      <input value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, onChange }) {
  return (
    <label>
      {label}
      <textarea value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EditableBlock({ block, onChange, onDelete }) {
  return (
    <article className="planner-card">
      <div className="form-grid">
        <Field label="时间" value={block.period} onChange={(period) => onChange({ ...block, period })} />
        <Field label="地点" value={block.place} onChange={(place) => onChange({ ...block, place })} />
        <TextAreaField label="做什么" value={block.activity} onChange={(activity) => onChange({ ...block, activity })} />
        <TextAreaField label="为什么值得去" value={block.highlight} onChange={(highlight) => onChange({ ...block, highlight })} />
        <TextAreaField label="提醒" value={block.tip} onChange={(tip) => onChange({ ...block, tip })} />
      </div>
      <button className="button small danger" type="button" onClick={onDelete}>删除这一段</button>
    </article>
  );
}
```

- [ ] **Step 3: Implement Today and Itinerary views**

Add:

```jsx
function TodayView({ day, items, weather, onChangeDay }) {
  if (!day) return null;
  const relatedItems = items.filter((item) => item.relatedDayId === day.id).slice(0, 6);
  const clothing = weather ? makeClothingAdvice(weather, day.clothingNote) : day.clothingNote;

  return (
    <>
      <section className="section today-panel">
        <p className="eyebrow">{day.date} {day.weekday}</p>
        <h2>{day.title}</h2>
        <p>{day.focus}</p>
        <div className="tags">
          <span className="tag">{day.city}</span>
          <span className="tag">{day.lodging || "住宿待补"}</span>
        </div>
      </section>
      <section className="section card">
        <div className="section-head">
          <h2>今天穿什么</h2>
          <span className="muted">{weather ? `${weather.minTemp}-${weather.maxTemp}°C` : "先看攻略提醒"}</span>
        </div>
        <p>{clothing}</p>
      </section>
      <DayEditor day={day} onChange={onChangeDay} compact />
      <RelatedItems items={relatedItems} />
    </>
  );
}

function ItineraryView({ days, items, onChangeDay }) {
  return (
    <section className="section timeline">
      {days.map((day) => (
        <DayEditor
          day={day}
          key={day.id}
          relatedItems={items.filter((item) => item.relatedDayId === day.id)}
          onChange={onChangeDay}
        />
      ))}
    </section>
  );
}
```

Implement `DayEditor` so each edit calls `onChange(nextDay)`. Add a button labeled `"加一个时间段"` that appends:

```js
{
  id: `${day.id}-block-${Date.now()}`,
  period: "补一个时间",
  place: "补一个地点",
  activity: "新的安排",
  highlight: "",
  tip: "",
}
```

When deleting a block, call `window.confirm("确定删除这段安排吗？")` before saving.

- [ ] **Step 4: Implement Lists view**

Add:

```jsx
function ListsView({ items, onChangeItem, onAddItem, onDeleteItem }) {
  return (
    <>
      {listSections.map((section) => (
        <section className="section" key={section.kind}>
          <div className="section-head">
            <h2>{section.title}</h2>
            <button className="button small" type="button" onClick={() => onAddItem(section.kind)}>加一条</button>
          </div>
          <div className="planner-grid">
            {items.filter((item) => item.kind === section.kind).map((item) => (
              <TripItemEditor item={item} key={item.id} onChange={onChangeItem} onDelete={() => onDeleteItem(item.id)} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
```

Implement `TripItemEditor` with labels `"名字"`, `"放在哪天"`, `"城市"`, `"现在怎样"`, `"金额"`, `"币种"`, `"链接"`, `"备注"`. The status select must use `tripItemStatuses`.

- [ ] **Step 5: Add focused CSS**

Append to `src/app/globals.css`:

```css
.eyebrow {
  color: var(--accent-strong);
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0;
}

.today-panel,
.planner-card {
  border: 1px solid rgba(21, 32, 31, 0.09);
  border-radius: 18px;
  background: rgba(255, 250, 240, 0.9);
  box-shadow: 0 8px 28px rgba(45, 55, 50, 0.08);
  padding: 16px;
}

.today-panel h2 {
  margin: 6px 0 8px;
  font-size: clamp(1.6rem, 5vw, 2.8rem);
  line-height: 1.08;
}

.timeline,
.planner-grid {
  display: grid;
  gap: 12px;
}

.day-blocks {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.planner-card .form-grid {
  margin-bottom: 10px;
}
```

- [ ] **Step 6: Run verification**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: tests, lint, and build complete successfully.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/components/TravelWorkspace.jsx src/app/globals.css
git commit -m "Build editable travel workspace views"
```

---

### Task 7: Ledger Workspace Copy Update

**Files:**
- Modify: `src/components/LedgerWorkspace.jsx`
- Modify: `src/lib/ledger.js`
- Modify: `tests/ledger.test.mjs`

- [ ] **Step 1: Update all traveler-facing labels**

In `src/components/LedgerWorkspace.jsx`:

- Replace `"我方付款"` with `formatPayerLabel("us")`.
- Replace `"对方付款"` and `"另一对夫妻付款"` with `formatPayerLabel("them")`.
- Replace settlement text with `formatSettlementDirection(bucket.netOtherOwesUs)`.
- Replace `"另一对夫妻应付我方"` with `"胡董还需给孙张"`.
- Replace `"我方应付另一对夫妻"` with `"孙张还需给胡董"`.
- Replace general header text that says `"两对夫妻"` only when it implies unnamed parties; keep generic "两对夫妻 50/50" if it reads naturally.

Import:

```js
import { formatPayerLabel, formatSettlementDirection } from "@/lib/couples";
```

- [ ] **Step 2: Update payer selects**

The payer select should render:

```jsx
<option value="us">孙张付款</option>
<option value="them">胡董付款</option>
```

Keep saved values as `"us"` and `"them"`.

- [ ] **Step 3: Update ledger route links**

Inside ledger dashboard actions, link to:

```jsx
<Link className="button primary" href="/ledger/add">记一笔</Link>
<Link className="button" href="/ledger/settlement">看结算</Link>
```

Inside ledger sub-navigation, use:

```jsx
<Link href="/ledger">账本总览</Link>
<Link href="/ledger/expenses">明细</Link>
<Link href="/ledger/add">记一笔</Link>
<Link href="/ledger/settlement">结算</Link>
```

- [ ] **Step 4: Search for forbidden labels**

Run:

```bash
rg "我方|对方|另一对夫妻" src tests
```

Expected: no user-facing matches in components. Matches in tests may remain only when testing internal payer ids; prefer removing visible wording from tests too.

- [ ] **Step 5: Run verification**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/components/LedgerWorkspace.jsx src/lib/ledger.js tests/ledger.test.mjs
git commit -m "Use couple names in ledger"
```

---

### Task 8: README And Supabase Setup Copy

**Files:**
- Modify: `README.md`
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Update README**

Replace `README.md` with:

````md
# Aussie Chill

澳洲旅行共享行程和 split bill 账本。行程、住宿、预订、美食、预算和账本放在同一个网站里，输入访问码后一起查看和维护。

## 本地运行

```bash
npm run dev
```

默认访问码是 `aussie`。上线时可以在 Vercel 里设置 `NEXT_PUBLIC_TRIP_CODE` 改成自己的访问码。

## 能做什么

- 今日：看当天安排、天气和穿衣提醒。
- 行程：查看和修改 D0-D16 每天的安排。
- 清单：整理住哪里、还要订什么、预算、想吃什么、活动和门票。
- 账本：记录孙张和胡董的垫付，按 CNY / AUD 分开结算。

## Supabase

不配置 Supabase 时，网页会用当前浏览器保存，适合先试用。

上线共享时：

1. 新建 Supabase project。
2. 在 SQL editor 执行 `supabase/schema.sql`。
3. 创建 Storage bucket：`receipts`。
4. 在 Vercel 环境变量中设置：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_TRIP_CODE`

## 验证

```bash
npm test
npm run lint
npm run build
```
````

- [ ] **Step 2: Update member seed names**

In `supabase/schema.sql`, change the existing member seed insert values to:

```sql
insert into public.members (id, trip_id, name)
values
  ('us', 'aussie-chill-2026', '孙张'),
  ('them', 'aussie-chill-2026', '胡董')
on conflict (id) do update set name = excluded.name;
```

- [ ] **Step 3: Run verification**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md supabase/schema.sql
git commit -m "Document travel workspace setup"
```

---

### Task 9: Browser Verification

**Files:**
- No source edits unless verification finds a bug.

- [ ] **Step 1: Start the dev server**

Run:

```bash
npm run dev
```

Expected: Next.js starts on `http://localhost:3000` or the next available port.

- [ ] **Step 2: Verify access gate**

Open the local URL. Confirm:

- Access page says "输入旅行访问码后进入共享行程和账本。"
- Wrong code shows "访问码不对".
- Correct code enters the app.

- [ ] **Step 3: Verify desktop pages**

At desktop width, check:

- `/` shows "今日" content.
- `/itinerary` shows D0-D16.
- `/lists` shows "住哪里", "还要订什么", "预算心里有数", "想吃什么", "活动和门票".
- `/ledger` shows ledger summary.
- `/ledger/add` can create a draft or confirmed expense.
- `/ledger/settlement` shows "孙张" and "胡董" in settlement wording.

- [ ] **Step 4: Verify mobile pages**

At mobile width around 390px, check:

- Bottom nav text fits.
- Form labels and buttons do not overlap.
- Day cards are readable.
- List item editing is usable without horizontal scrolling.
- Ledger amount cards remain readable.

- [ ] **Step 5: Verify editing**

In the app:

- Change one day title, reload, and confirm it remains in local fallback.
- Add one list item, reload, and confirm it remains in local fallback.
- Delete a list item and confirm the browser asks for confirmation.
- Add a ledger expense with payer "胡董付款" and confirm settlement changes.

- [ ] **Step 6: Stop dev server**

Stop the dev server with `Ctrl-C`.

- [ ] **Step 7: Commit verification fixes**

If verification required source fixes, commit them:

```bash
git add src README.md supabase/schema.sql tests
git commit -m "Polish travel workspace verification issues"
```

If no fixes were needed, do not create an empty commit.

---

### Task 10: Final Full Verification

**Files:**
- No source edits unless verification finds a bug.

- [ ] **Step 1: Run complete checks**

Run:

```bash
npm test
npm run lint
npm run build
git status --short
```

Expected:

- Tests pass.
- Lint passes.
- Build passes, with the known local SWC warning allowed if webpack completes successfully.
- `git status --short` is clean or only contains intentionally uncommitted local environment files.

- [ ] **Step 2: Confirm required user-facing language**

Run:

```bash
rg "我方|对方|另一对夫妻|Supabase|API|CRUD|数据库|同步" src/app src/components
```

Expected:

- No matches for "我方", "对方", or "另一对夫妻".
- No user-facing component text mentioning "Supabase", "API", "CRUD", "数据库", or "同步".
- Internal imports or variable names are acceptable only if they are not rendered text.

- [ ] **Step 3: Confirm seeded content coverage**

Run:

```bash
npm test -- tests/travelSeed.test.mjs
```

Expected: PASS and confirms D0-D16 plus key lodging, booking, budget, food, and activity content.

- [ ] **Step 4: Final commit if needed**

If any final source fixes were made, commit them:

```bash
git add .
git commit -m "Finalize travel workspace"
```

Do not commit ignored folders such as `.next/`, `node_modules/`, or `.superpowers/`.
