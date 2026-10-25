import { expect, test } from "./fixtures/test.js";
import { documentOverflowsHorizontally, findClippedText } from "./fixtures/layout.js";

// 2027-02-10 09:00 in New Zealand (local browser clock): D10, Wānaka → Te Anau.
const duringTrip = new Date("2027-02-10T09:00:00+13:00");
const beforeTrip = new Date("2026-11-11T10:00:00+08:00");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(duringTrip);
});

test("itinerary exposes deterministic current-day and stage controls", async ({ page }) => {
  await page.goto("/itinerary");

  const today = page.getByRole("region", { name: "今日旅行控制台" });
  await expect(today.getByRole("heading", { name: /D10 · 02\.10 周三/ })).toBeVisible();
  const stageNavigator = page.getByRole("region", { name: "当前行程阶段" });
  await expect(stageNavigator).toContainText("今天D10");
  await expect(stageNavigator.getByRole("tab", { name: "Wānaka · 峡湾 · 皇后镇" })).toHaveAttribute("aria-selected", "true");

  await stageNavigator.getByRole("tab", { name: "Auckland + 返程" }).click();
  await expect(page.locator("#d15")).toBeVisible();
  await expect(page.locator("#d1")).toHaveCount(0);
  const dayLink = page.locator(".stage-days a[href='#d15']");
  await expect(dayLink).toHaveText("D15");
  await dayLink.click();
  await expect(page).toHaveURL(/\/itinerary#d15$/);

  await stageNavigator.getByRole("button", { name: "查看全部路书" }).click();
  await expect(page.locator("#d1")).toBeVisible();
  await expect(page.locator("#d17")).toBeVisible();
  await stageNavigator.getByRole("button", { name: "收起其他阶段" }).click();
  await expect(page.locator("#d1")).toHaveCount(0);
});

test("the current drive day shows its segment table and Google Maps links", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/itinerary");

  const d10 = page.locator("#d10");
  await d10.scrollIntoViewIfNeeded();
  const guide = d10.getByRole("region", { name: /导航07/ });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("row")).toHaveCount(6);
  await expect(guide.getByRole("link", { name: /第一段经Cromwell到Frankton/ })).toHaveAttribute("href", /google\.com\/maps\/dir/);
  await expect(d10.locator(".day-notes .is-advice")).toContainText("Crown Range");
});

test("trip board lists lodging deadlines, payments, and route advice", async ({ page }) => {
  await page.clock.setFixedTime(beforeTrip);
  await page.goto("/itinerary");

  const board = page.getByRole("region", { name: "行前清单与路线建议" });
  await expect(board.getByRole("article", { name: "住宿地址和订单" })).toContainText("免费取消至 2027/1/13 15:00");
  await expect(board.getByRole("article", { name: "出发前需要落实的事项" })).toContainText("Te Anau尾款 NZ$386.40");
  const advice = board.getByRole("article", { name: "路线建议" });
  await expect(advice.locator("details")).toHaveCount(5);
  await advice.getByText("2/15 Hobbiton当天往返约5–6小时驾驶").click();
  await expect(advice).toContainText("两人轮流开");
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
  await page.clock.setFixedTime(beforeTrip);
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
  const currentDay = page.locator("#d10");
  await expect(currentDay).toBeAttached();
  await currentDay.scrollIntoViewIfNeeded();
  await expect(currentDay.locator("h3")).toHaveText("经Cromwell去Te Anau");
  expect(await documentOverflowsHorizontally(page)).toBe(false);
  expect(await findClippedText(page)).toEqual([]);
});

test("mobile direct D15 link keeps the offscreen stage inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(beforeTrip);
  await page.goto("/itinerary#d15");

  const d15 = page.locator("#d15");
  await expect(d15).toBeAttached();
  await expect(d15.locator("h3")).toHaveText("Hobbiton中文团，一天往返");
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
  await page.clock.setFixedTime(beforeTrip);
  await page.goto("/itinerary");

  const checkbox = page.locator(".carry-check-item input").first();
  await checkbox.scrollIntoViewIfNeeded();
  const checkboxWidth = await checkbox.evaluate((element) => element.getBoundingClientRect().width);
  expect(checkboxWidth).toBeLessThanOrEqual(28);

  const d5 = page.locator("#d5");
  await expect(d5).toBeAttached();
  await expect(d5.locator(".day-execution-grid")).toHaveCount(0);
  await d5.scrollIntoViewIfNeeded();
  await d5.getByText("查看当天安排", { exact: true }).click();
  await expect(d5.locator(".day-execution-grid")).toBeVisible();
  await expect(d5.locator(".drive-guide")).toBeVisible();
  expect(await documentOverflowsHorizontally(page)).toBe(false);
});
