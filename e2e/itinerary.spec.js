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

test("mobile itinerary keeps controls and day text inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/itinerary");

  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  const currentDay = page.locator("#d2");
  await expect(currentDay).toBeAttached();
  await currentDay.scrollIntoViewIfNeeded();
  await expect(currentDay.locator("h3")).toHaveText("Puffing Billy + Sassafras 半日团");
  expect(await documentOverflowsHorizontally(page)).toBe(false);
  expect(await findClippedText(page)).toEqual([]);
});

test("mobile direct D15 link keeps the offscreen stage inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2026-07-11T10:00:00+08:00"));
  await page.goto("/itinerary#d15");

  const d15 = page.locator("#d15");
  await expect(d15).toBeAttached();
  await expect(d15.locator("h3")).toHaveText("Taronga Zoo + 最后采购 + Cafe Sydney");
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
