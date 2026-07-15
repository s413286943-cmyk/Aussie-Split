# Forecast Clothing And Day Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make forecast-window clothing advice genuinely forecast-driven and reduce every D0-D16 overview paragraph to one approved rhythm sentence.

**Architecture:** Keep Open-Meteo and the existing six-hour coordinate cache. Extend the daily payload parsing in `src/lib/weather.js`, expose an explicit `adviceLabel`, render that label wherever advice is shown, and keep the workbook as the sole source for focus copy before regenerating JSON.

**Tech Stack:** Next.js, React, JavaScript modules, Node test runner, Open-Meteo, Excel/openpyxl import pipeline, Playwright.

---

## File Map

- `src/lib/weather.js`: forecast URL, daily field parsing, deterministic clothing rules, source labels, fallbacks.
- `tests/weather.test.mjs`: weather URL, advice bands/modifiers, source labels, missing-data behavior, cache regressions.
- `src/components/ItineraryApp.jsx`: source label in day cards and next-day hero.
- `src/components/itinerary/TodayConsole.jsx`: source label in the current-day console.
- `tests/weather-ui.test.mjs`: lightweight UI contract ensuring both itinerary surfaces render the provided source label.
- `content/aussie-itinerary.xlsx`: D0-D16 `focus` source values only.
- `src/data/itinerary.generated.json`: importer-generated reflection of the workbook.
- `tests/itinerary.test.mjs`: exact approved focus-copy regression plus existing fixed-stop checks.

### Task 1: Forecast-driven clothing contract

**Files:**
- Modify: `tests/weather.test.mjs`
- Modify: `src/lib/weather.js`

- [ ] **Step 1: Write failing URL and advice tests**

Add assertions that the URL requests `apparent_temperature_min`, `apparent_temperature_max`, and `wind_speed_10m_max`. Add focused tests for all five temperature bands, the ordered rain/wind/UV modifiers, forecast `adviceLabel`, and fallback `adviceLabel`.

```js
assert.match(url, /apparent_temperature_min/);
assert.match(url, /apparent_temperature_max/);
assert.match(url, /wind_speed_10m_max/);

assert.equal(
  buildWeatherAdvice({ apparentMin: 8, min: 9, rain: 55, wind: 28, uv: 7 }),
  "毛衣 / 抓绒 + 防风外套；带防水外层或雨具；海边优先防风；做好防晒",
);
assert.equal(fallbackWeather(day).adviceLabel, "季节穿衣参考");
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `node --conditions=react-server --test tests/weather.test.mjs`

Expected: FAIL because the daily URL fields and `adviceLabel` do not exist and `buildWeatherAdvice` still falls back to workbook copy.

- [ ] **Step 3: Implement the minimum weather behavior**

In `buildWeatherUrl`, request:

```js
daily: "temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max,weather_code",
```

Make fallback output explicit:

```js
export function fallbackWeather(day) {
  return {
    status: "fallback",
    summary: day.climateNote,
    detail: day.clothingNote,
    adviceLabel: "季节穿衣参考",
  };
}
```

In `summarizeWeather`, require a finite daily temperature range, read daily apparent minimum and maximum plus maximum wind, and return:

```js
return {
  status,
  summary: [condition, range, nowText].filter(Boolean).join(" · "),
  detail: buildWeatherAdvice({ apparentMin, min, rain, uv, wind }),
  adviceLabel: "预报穿衣建议",
};
```

Implement the approved bands and ordered modifiers in `buildWeatherAdvice`:

```js
export function buildWeatherAdvice({ apparentMin, min, rain, uv, wind }) {
  const temperature = Number.isFinite(apparentMin) ? apparentMin : min;
  let base = "短袖为主";
  if (temperature <= 5) base = "轻薄羽绒 + 保暖中层";
  else if (temperature <= 10) base = "毛衣 / 抓绒 + 防风外套";
  else if (temperature <= 15) base = "长袖 + 薄外套";
  else if (temperature <= 20) base = "短袖或长袖叠穿，带薄外套";

  const advice = [base];
  if (Number.isFinite(rain) && rain >= 50) advice.push("带防水外层或雨具");
  if (Number.isFinite(wind) && wind >= 25) advice.push("海边优先防风");
  if (Number.isFinite(uv) && uv >= 6) advice.push("做好防晒");
  return advice.join("；");
}
```

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run: `node --conditions=react-server --test tests/weather.test.mjs`

Expected: all weather tests PASS with no warnings.

- [ ] **Step 5: Commit the weather contract**

```bash
git add src/lib/weather.js tests/weather.test.mjs
git commit -m "feat: generate clothing advice from daily forecast"
```

### Task 2: Surface the clothing source consistently

**Files:**
- Create: `tests/weather-ui.test.mjs`
- Modify: `src/components/ItineraryApp.jsx`
- Modify: `src/components/itinerary/TodayConsole.jsx`

- [ ] **Step 1: Write the failing UI-source contract**

Create a source-level contract matching the existing repository test style:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const itinerarySource = readFileSync(new URL("../src/components/ItineraryApp.jsx", import.meta.url), "utf8");
const todaySource = readFileSync(new URL("../src/components/itinerary/TodayConsole.jsx", import.meta.url), "utf8");

it("shows the weather advice source beside every clothing recommendation", () => {
  assert.match(itinerarySource, /weather\.adviceLabel/);
  assert.match(todaySource, /weather\?\.adviceLabel/);
  assert.match(itinerarySource, /季节穿衣参考/);
  assert.match(todaySource, /季节穿衣参考/);
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `node --conditions=react-server --test tests/weather-ui.test.mjs`

Expected: FAIL because neither component renders `adviceLabel` yet.

- [ ] **Step 3: Render the label without redesigning the cards**

Use the existing text slots:

```jsx
<small>{weather.adviceLabel} · {weather.detail}</small>
```

and:

```jsx
<article>
  <span>{weather?.adviceLabel || "季节穿衣参考"}</span>
  <strong>{weather?.detail || day.clothingNote}</strong>
</article>
```

Apply the same compact label to the next-day hero so static fallback copy is not presented without its source.

- [ ] **Step 4: Run the UI contract and weather tests**

Run: `node --conditions=react-server --test tests/weather-ui.test.mjs tests/weather.test.mjs`

Expected: both files PASS.

- [ ] **Step 5: Commit the display change**

```bash
git add src/components/ItineraryApp.jsx src/components/itinerary/TodayConsole.jsx tests/weather-ui.test.mjs
git commit -m "ui: label forecast and seasonal clothing advice"
```

### Task 3: Replace D0-D16 focus copy from the workbook

**Files:**
- Modify: `tests/itinerary.test.mjs`
- Modify: `content/aussie-itinerary.xlsx`
- Modify: `src/data/itinerary.generated.json`

- [ ] **Step 1: Write the failing exact-copy regression**

Add the approved map and assert every generated day focus equals it:

```js
const expectedFocus = {
  d0: "经香港转机，夜航前往墨尔本。",
  d1: "落地恢复，轻走 CBD；晚间逛 QVM 冬季夜市。",
  d2: "蒸汽小火车半日，下午漫步 Fitzroy。",
  d3: "机场取车轻装上路，沿海开到 Apollo Bay。",
  d4: "穿过雨林走向十二使徒岩，傍晚抵达 Port Campbell。",
  d5: "清晨补拍海岸，走内陆线返回墨尔本机场。",
  d6: "从冬季飞进热带，傍晚漫步凯恩斯海滨。",
  d7: "全天留给大堡礁外礁平台与海上体验。",
  d8: "沿丹翠河深入雨林，在 Cape Tribulation 看雨林入海。",
  d9: "轻量自驾串联火山湖、巨树、高原小镇与瀑布。",
  d10: "逛 Rusty’s Market，休整后去 Palm Cove 看海。",
  d11: "飞抵悉尼休息后，经 Barangaroo 走向海港夜景。",
  d12: "从歌剧院导览一路步行到花园、经典机位与 QVB。",
  d13: "沿 Grand Pacific Drive 南下，串联海崖桥与南海岸小镇。",
  d14: "上午看澳洲动物，下午走 Bondi 海岸，晚上吃 Totti’s。",
  d15: "早上按状态决定 Manly，下午采购整理，傍晚 Cafe Sydney。",
  d16: "完成 TRS 与机场手续，启程回家。",
};

for (const day of itinerary.days) assert.equal(day.focus, expectedFocus[day.id]);
```

Update the pre-existing D1 QVM assertion to match `QVM 冬季夜市`, because the full official event name remains in the D1 block.

- [ ] **Step 2: Run the itinerary test and verify RED**

Run: `node --conditions=react-server --test tests/itinerary.test.mjs`

Expected: FAIL on the old long `focus` values.

- [ ] **Step 3: Update only the workbook Days.focus cells**

Use the bundled Python/openpyxl runtime to load the existing workbook, find the `day_id` and `focus` columns by header, replace D0-D16 values from the exact map above, and save the same workbook. Do not rebuild the workbook or touch Blocks, Resources, finance sheets, styles, formulas, dimensions, or images.

- [ ] **Step 4: Regenerate the site data**

Run: `npm run itinerary:import`

Expected: `Imported 17 days to src/data/itinerary.generated.json`.

- [ ] **Step 5: Run source and content tests**

Run: `node --conditions=react-server --test tests/itinerary.test.mjs tests/itinerary-generated.test.mjs`

Expected: both files PASS, including fixed Carlton, Fitzroy, Palm Cove, Barangaroo, D13-D15, and workbook-equality checks.

- [ ] **Step 6: Commit the content change**

```bash
git add content/aussie-itinerary.xlsx src/data/itinerary.generated.json tests/itinerary.test.mjs
git commit -m "content: shorten daily itinerary summaries"
```

### Task 4: Full regression, browser verification, and release

**Files:**
- Verify only; change no files unless a failing test exposes a scoped defect.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all repository tests PASS except documented environment-only database skips; lint and build exit 0.

- [ ] **Step 2: Start the tested local build and verify desktop/mobile**

Inspect `/itinerary` at desktop and 390px mobile widths. Confirm D1/D2 collapsed two-column behavior, full-row desktop expansion, single-column mobile behavior, concise focus lines, forecast/fallback clothing labels, Today Console parity, checklist sizing, ticket cards, and no horizontal overflow.

- [ ] **Step 3: Verify ledger and resilience contracts**

Run the existing local E2E flows and check real ledger sync, offline reopening/recovery, receipts, and navigation. The itinerary-only change must not alter calculations or stored state.

- [ ] **Step 4: Review the release diff**

Run:

```bash
git diff origin/main...HEAD --check
git status --short
```

Expected: only the design/plan docs and the files listed above are changed; the worktree is clean after commits.

- [ ] **Step 5: Deploy the exact tested commit and verify production**

Push the protected-recovery branch to `origin/main` using the repository's established fast-forward/release path, wait for Vercel production completion, then repeat the desktop/mobile itinerary smoke checks and ledger/offline/receipt spot checks on `https://aussie-split.vercel.app/`.
