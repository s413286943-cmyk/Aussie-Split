import { expect, test } from "./fixtures/test.js";
import { documentOverflowsHorizontally, findClippedText } from "./fixtures/layout.js";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-30T10:00:00+08:00"));
});

test("itinerary exposes deterministic current-day and stage controls", async ({ page }) => {
  await page.goto("/itinerary");

  const today = page.getByRole("region", { name: "今日旅行控制台" });
  await expect(today.getByRole("heading", { name: /D2 · 07\.30 周四/ })).toBeVisible();
  const stageNavigator = page.getByRole("region", { name: "当前行程阶段" });
  await expect(stageNavigator).toContainText("今天D2");
  await expect(stageNavigator.getByRole("tab", { name: "墨尔本 + 大洋路" })).toHaveAttribute("aria-selected", "true");

  await stageNavigator.getByRole("tab", { name: "凯恩斯热带暖冬" }).click();
  await expect(page.locator("#d6")).toBeVisible();
  await expect(page.locator("#d1")).toHaveCount(0);
  const dayLink = page.locator(".stage-days a[href='#d6']");
  await expect(dayLink).toHaveText("D6");
  await dayLink.click();
  await expect(page).toHaveURL(/\/itinerary#d6$/);

  await stageNavigator.getByRole("button", { name: "查看全部路书" }).click();
  await expect(page.locator("#d1")).toBeVisible();
  await expect(page.locator("#d15")).toBeVisible();
  await stageNavigator.getByRole("button", { name: "收起其他阶段" }).click();
  await expect(page.locator("#d1")).toHaveCount(0);
});

test("desktop itinerary has no page overflow or clipped operational text", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  await page.goto("/itinerary");

  await expect(page.locator(".day-grid.has-current-day")).toHaveCSS("grid-template-columns", /\d+px/);
  const currentStageColumns = await page.locator(".day-grid.has-current-day").evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length
  ));
  expect(currentStageColumns).toBe(1);

  await page.getByRole("region", { name: "当前行程阶段" }).getByRole("button", { name: "查看全部路书" }).click();

  expect(await documentOverflowsHorizontally(page)).toBe(false);
  expect(await findClippedText(page)).toEqual([]);
});

test("an expanded desktop day owns the full row without stretching its sibling", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-07-11T10:00:00+08:00"));
  await page.goto("/itinerary");

  const d1 = page.locator("#d1");
  await d1.getByText("查看当天安排", { exact: true }).click();
  const widthRatio = await d1.evaluate((element) => (
    element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width
  ));

  expect(widthRatio).toBeGreaterThan(0.95);
  await expect(page.locator("#d2 details")).not.toHaveAttribute("open", "");
});

test("the polished D1 plan and Great Ocean Road Wildlife Park render in their updated day plans", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/itinerary");

  const d1 = page.locator("#d1");
  await d1.getByText("查看当天安排", { exact: true }).click();
  await expect(d1.locator("h3")).toHaveText("初到墨尔本：QVM 冬季夜市");
  await expect(d1.locator(".timeline").getByRole("heading", {
    name: "墨尔本机场 (MEL)",
    level: 4,
  })).toBeVisible();
  await expect(d1.locator(".timeline").getByRole("heading", {
    name: "Queen Victoria Market",
    level: 4,
  })).toBeVisible();
  await expect(d1.locator(".timeline")).not.toContainText("Point Ormond");
  await expect(d1.locator(".timeline")).not.toContainText("Carlton");

  const d5 = page.locator("#d5");
  await d5.getByText("查看当天安排", { exact: true }).click();
  await expect(d5.locator("h3")).toHaveText("海岸地貌到野生动物：大洋路返程日");
  await expect(d5.locator(".timeline").getByRole("heading", {
    name: "Great Ocean Road Wildlife Park",
    level: 4,
  })).toBeVisible();
  await expect(d5.locator(".timeline")).not.toContainText("Bay of Islands");
});

test("D3 renders the airport luggage handoff, Torquay shop, and coastal drive in order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/itinerary#d3");

  const d3 = page.locator("#d3");
  await d3.getByText("查看当天安排", { exact: true }).click();
  await expect(d3.locator("h3")).toHaveText("驶上大洋路：从 Torquay 海岸到 Apollo Bay");

  const places = await d3.locator(".timeline .time-block h4").allTextContents();
  expect(places.slice(0, 14)).toEqual([
    "Oaks Melbourne on Market Hotel",
    "Holiday Inn Melbourne Airport",
    "Melbourne Airport Car Rental Branch",
    "墨尔本机场 → Torquay",
    "Coles Torquay",
    "Bells Beach",
    "Split Point Lighthouse",
    "Great Ocean Road Memorial Arch",
    "Lorne",
    "Teddy's Lookout",
    "Kennett River / Grey River Road",
    "Cape Patton Lookout",
    "Seaview Motel & Apartments",
    "Seaview Motel & Apartments",
  ]);

  await expect(d3.locator(".timeline")).toContainText("4 个大箱");
  await expect(d3.locator(".food-brief")).toContainText("Seaview Motel BBQ");
  await expect(d3.getByRole("region", { name: "每日地图快捷入口" }).getByRole("link", { name: "打开第一站" })).toHaveAttribute("href", /Holiday\+Inn\+Melbourne\+Airport/);
  await expect(d3.getByRole("link", { name: "地图 · Coles Torquay" }).first()).toHaveAttribute("href", /Coles\+Torquay\+41\+Bristol/);
  await expect(d3.getByRole("link", { name: "地图 · Grey River Road · Kennett River" }).first()).toHaveAttribute("href", /Grey\+River\+Road/);
});

test("mobile itinerary keeps controls and day text inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/itinerary");

  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  const currentDay = page.locator("#d2");
  await expect(currentDay).toBeAttached();
  await currentDay.scrollIntoViewIfNeeded();
  await expect(currentDay.locator("h3")).toHaveText("从城市巷弄到山林：Puffing Billy 与 Fitzroy");
  expect(await documentOverflowsHorizontally(page)).toBe(false);
  expect(await findClippedText(page)).toEqual([]);
});

test("mobile pre-trip hero keeps the first screen compact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2026-07-17T10:00:00+08:00"));
  await page.goto("/itinerary");

  const hero = page.locator(".route-hero:not(.is-compact)");
  await expect(hero).toBeVisible();
  const layout = await hero.evaluate((element) => {
    const title = element.querySelector(".itinerary-hero-copy h1");
    const meta = element.querySelector(".hero-meta");
    const routeStrip = element.querySelector(".hero-route-strip");
    const weather = element.querySelector(".hero-weather");
    return {
      heroHeight: element.getBoundingClientRect().height,
      titleHeight: title?.getBoundingClientRect().height ?? 0,
      metaHeight: meta?.getBoundingClientRect().height ?? 0,
      routeStripDisplay: routeStrip ? getComputedStyle(routeStrip).display : "missing",
      weatherHeight: weather?.getBoundingClientRect().height ?? 0,
    };
  });

  expect(layout.heroHeight).toBeLessThanOrEqual(480);
  expect(layout.titleHeight).toBeLessThanOrEqual(80);
  expect(layout.metaHeight).toBeLessThanOrEqual(66);
  expect(layout.routeStripDisplay).toBe("none");
  expect(layout.weatherHeight).toBeLessThanOrEqual(145);
  expect(await documentOverflowsHorizontally(page)).toBe(false);
  expect(await findClippedText(page)).toEqual([]);
});

test("mobile direct D15 link keeps the offscreen stage inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2026-07-11T10:00:00+08:00"));
  await page.goto("/itinerary#d15");

  const d15 = page.locator("#d15");
  await expect(d15).toBeAttached();
  await expect(d15.locator("h3")).toHaveText("悉尼告别日：可选 Manly、最后采购与 Cafe Sydney");
  const bounds = await d15.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth };
  });

  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  expect(await documentOverflowsHorizontally(page)).toBe(false);
  expect(await findClippedText(page)).toEqual([]);
});

test("mobile itinerary aligns the field kit and lazily opens non-current day tools", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/itinerary");

  const checkbox = page.locator(".carry-check-item input").first();
  await checkbox.scrollIntoViewIfNeeded();
  const checkboxWidth = await checkbox.evaluate((element) => element.getBoundingClientRect().width);
  expect(checkboxWidth).toBeLessThanOrEqual(28);

  const d1 = page.locator("#d1");
  await expect(d1).toBeAttached();
  await expect(d1.locator(".day-execution-grid")).toHaveCount(0);
  await d1.scrollIntoViewIfNeeded();
  await d1.getByText("查看当天安排", { exact: true }).click();
  await expect(d1.locator(".day-execution-grid")).toBeVisible();
});
