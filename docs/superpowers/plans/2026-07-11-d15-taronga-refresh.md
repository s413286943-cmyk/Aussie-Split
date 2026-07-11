# D15 Taronga Zoo Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace D15's Manly itinerary with the supplied Taronga Zoo day plan and a new GPT Image cover, then publish the Excel-backed update.

**Architecture:** Keep `content/aussie-itinerary.xlsx` as the only itinerary source of truth. Add a focused generated bitmap asset, regenerate `src/data/itinerary.generated.json` through the existing importer, and assert that D15 contains Taronga resources without stale Manly content.

**Tech Stack:** Excel/OpenPyXL through the bundled workspace Python runtime, Node.js itinerary importer and tests, Next.js, GPT Image generation, Playwright.

---

### Task 1: Lock the D15 data contract

**Files:**
- Modify: `tests/itinerary.test.mjs`

- [ ] **Step 1: Add the failing D15 regression test**

```js
it("uses the Taronga Zoo plan and cover on D15 without Manly leftovers", () => {
  const d15 = itinerary.days.find((day) => day.id === "d15");
  const d15Text = [d15.title, d15.focus, ...d15.blocks.map((block) => `${block.place} ${block.activity} ${block.tip}`)].join(" ");

  assert.equal(d15.coverImageUrl, "/itinerary/d15-taronga-zoo-harbour.png");
  assert.match(d15.coverImageAlt, /Taronga|长颈鹿|悉尼港/);
  assert.match(d15.primaryResource.title, /Taronga Zoo/);
  assert.match(d15.ticketResource.title, /Taronga Zoo/);
  assert.match(d15Text, /Taronga Zoo/);
  assert.match(d15Text, /Cafe Sydney/);
  assert.doesNotMatch(d15Text, /Manly|Hugos|Felons/i);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --conditions=react-server --test --test-name-pattern="Taronga Zoo plan" tests/itinerary.test.mjs`

Expected: FAIL because D15 still points to the Manly plan and the old harbour cover.

### Task 2: Generate the D15 cover

**Files:**
- Create: `public/itinerary/d15-taronga-zoo-harbour.png`

- [ ] **Step 1: Generate the bitmap with GPT Image**

Generate a realistic 16:9 editorial travel photograph showing Taronga Zoo giraffes in the foreground and Sydney Opera House plus Harbour Bridge across the water. Keep the lower corners visually quiet for the existing D15/date overlays; include no text, logos, borders, or UI.

- [ ] **Step 2: Inspect and normalize the asset**

Verify the subject is recognizable, no text is embedded, the lower overlays remain readable, and the final file is a 1280x720 PNG at the exact target path.

### Task 3: Update the Excel source and generated itinerary

**Files:**
- Modify: `content/aussie-itinerary.xlsx`
- Modify: `src/data/itinerary.generated.json`

- [ ] **Step 1: Update the `Days` row for `d15`**

Set the title to `Taronga Zoo + 最后采购 + Cafe Sydney`, use the supplied Taronga focus text, point the cover to `/itinerary/d15-taronga-zoo-harbour.png`, set a Taronga-specific alt, keep ferry plus city transport, set the morning ferry and `16:40` dinner departure guidance, and link the primary/ticket fields to Taronga resources.

- [ ] **Step 2: Replace D15 `Blocks` rows**

Use the supplied timetable from `08:30-09:00` through the `17:30` Cafe Sydney booking, preserve the hotel/TRS packing step, and update the meal block to `Taronga Zoo Cafe / 自带轻食 / Circular Quay casual lunch`.

- [ ] **Step 3: Update `Resources`**

Add Taronga Zoo map and official resources. Remove D15-only Manly Ferry, Manly Beach, Hugos, and Felons resource rows when no other day references them.

- [ ] **Step 4: Regenerate data through the importer**

Run: `npm run itinerary:import`

Expected: `Imported 17 days to src/data/itinerary.generated.json`.

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `node --conditions=react-server --test --test-name-pattern="Taronga Zoo plan" tests/itinerary.test.mjs`

Expected: PASS.

### Task 4: Verify the rendered update

**Files:**
- Verify: `content/aussie-itinerary.xlsx`
- Verify: `src/data/itinerary.generated.json`
- Verify: `public/itinerary/d15-taronga-zoo-harbour.png`

- [ ] **Step 1: Run automated verification**

Run: `npm test`

Expected: all tests pass with no failures.

Run: `npm run lint`

Expected: exit code 0.

Run: `npm run build`

Expected: production build completes successfully.

- [ ] **Step 2: Run browser verification**

Run the local app and inspect `/itinerary#d15` at desktop and mobile widths. Confirm the cover is not blank or poorly cropped, D15 text stays inside its card, quick links open Taronga resources, Cafe Sydney remains at 17:30, and no Manly copy appears in D15.

### Task 5: Commit and publish

**Files:**
- Commit only the D15 specification, plan, test, Excel, generated JSON, and new cover asset.

- [ ] **Step 1: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors and no unrelated files.

- [ ] **Step 2: Commit**

```bash
git add tests/itinerary.test.mjs content/aussie-itinerary.xlsx src/data/itinerary.generated.json public/itinerary/d15-taronga-zoo-harbour.png docs/superpowers/plans/2026-07-11-d15-taronga-refresh.md
git commit -m "feat: replace D15 Manly plan with Taronga Zoo"
```

- [ ] **Step 3: Push and verify production**

Push the branch/main by fast-forward only, wait for Vercel production to reach `Ready`, and run the read-only production smoke test.
