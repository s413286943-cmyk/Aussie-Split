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
  await expect(d5.locator("h3")).toHaveText("晨光中的海岸：十二使徒岩、Loch Ard Gorge 与野生动物");
  await expect(d5.locator(".timeline").getByRole("heading", {
    name: "Twelve Apostles",
    level: 4,
  })).toBeVisible();
  await expect(d5.locator(".timeline").getByRole("heading", {
    name: "The Grotto",
    level: 4,
  })).toBeVisible();
  await expect(d5.locator(".timeline").getByRole("heading", {
    name: "Great Ocean Road Wildlife Park",
    level: 4,
  })).toBeVisible();
  await expect(d5.locator(".timeline").getByRole("heading", {
    name: "Holiday Inn Melbourne Airport",
    level: 4,
  })).toBeVisible();
  await expect(d5.locator(".timeline")).not.toContainText("Bay of Islands");
});

test("the Cairns stage renders its booked times, Kuranda highland drive, and Palm Cove finish", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/itinerary");

  await page.getByRole("region", { name: "当前行程阶段" })
    .getByRole("tab", { name: "凯恩斯热带暖冬" })
    .click();

  const d6 = page.locator("#d6");
  await d6.getByText("查看当天安排", { exact: true }).click();
  await expect(d6.locator("h3")).toHaveText("初到凯恩斯：热带花园、海滨与夜市");
  await expect(d6.locator(".timeline")).toContainText("Cairns Botanic Gardens");
  await expect(d6.locator(".timeline")).toContainText("Esplanade Boardwalk");
  await expect(d6.locator(".timeline")).toContainText("7 月 13 日至 8 月 16 日因维护关闭");
  await expect(d6.locator(".timeline")).not.toContainText("免费泻湖泳池");

  const d7 = page.locator("#d7");
  await d7.getByText("查看当天安排", { exact: true }).click();
  await expect(d7.locator(".timeline")).toContainText("08:15 开始登船");
  await expect(d7.locator(".timeline")).toContainText("约 17:00 回到凯恩斯");

  const d8 = page.locator("#d8");
  await d8.getByText("查看当天安排", { exact: true }).click();
  await expect(d8.locator(".timeline")).toContainText("订单集合时间 06:55");
  await expect(d8.locator(".timeline")).toContainText("Daintree River Cruise");

  const d9 = page.locator("#d9");
  await d9.getByText("查看当天安排", { exact: true }).click();
  await expect(d9.locator("h3")).toHaveText("从雨林小镇到高原瀑布：Kuranda、Skybury 与 Millaa Millaa");
  await expect(d9.locator(".timeline")).toContainText("Kuranda Village");
  await expect(d9.locator(".timeline").getByRole("heading", { name: "Mareeba", exact: true, level: 4 })).toBeVisible();
  await expect(d9.locator(".timeline").getByRole("heading", { name: "Skybury Cafe & Roastery", level: 4 })).toBeVisible();
  await expect(d9.locator(".timeline")).toContainText("Lake Eacham Day Use Area");
  await expect(d9.locator(".timeline")).toContainText("Yungaburra Village");
  await expect(d9.locator(".timeline")).toContainText("Curtain Fig Tree");
  await expect(d9.locator(".timeline")).toContainText("Millaa Millaa Public Toilets");
  await expect(d9.locator(".timeline")).toContainText("15:35–18:00");
  await expect(d9.locator(".timeline")).not.toContainText("Gallo Dairyland");
  await expect(d9.locator(".timeline")).not.toContainText("Platypus Viewing Platform");
  await expect(d9.locator(".timeline")).not.toContainText("Ellinjaa Falls");
  await expect(d9.getByRole("link", { name: "地图 · Skybury Cafe & Roastery" }).first()).toHaveAttribute("href", /136\+Ivicevic/);

  const d10 = page.locator("#d10");
  await d10.getByText("查看当天安排", { exact: true }).click();
  await expect(d10.locator(".timeline")).toContainText("Williams Esplanade");
  await expect(d10.locator(".timeline")).toContainText("Palm Cove Jetty");
  await expect(d10.locator(".timeline")).toContainText("Jetstar 在线值机");
  await expect(d10.locator(".timeline")).not.toContainText("Esplanade Lagoon");
});

test("the Sydney stage renders the revised D11-D15 plan", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/itinerary");

  await page.getByRole("region", { name: "当前行程阶段" })
    .getByRole("tab", { name: "悉尼 + 南海岸" })
    .click();

  const d11 = page.locator("#d11");
  await d11.getByText("查看当天安排", { exact: true }).click();
  await expect(d11.locator("h3")).toHaveText("从热带飞抵海港：Barangaroo、The Rocks 与 Circular Quay");
  await expect(d11.locator(".timeline")).toContainText("12:30–14:45");
  await expect(d11.locator(".timeline")).toContainText("Barangaroo Reserve / Wulugul Walk");
  await expect(d11.locator(".timeline")).toContainText("17:00–17:45");

  const d12 = page.locator("#d12");
  await d12.getByText("查看当天安排", { exact: true }).click();
  await expect(d12.locator("h3")).toHaveText("海港晨光与城市经典：Mrs Macquarie's Chair、歌剧院与 QVB");
  await expect(d12.locator(".timeline")).toContainText("Mrs Macquarie's Chair");
  await expect(d12.locator(".timeline")).toContainText("09:30–10:30");
  await expect(d12.locator(".timeline")).toContainText("QVB / Westfield / CBD");
  await expect(d12.locator(".timeline")).not.toContainText("The Rocks Markets");
  await expect(d12.locator(".timeline")).not.toContainText("IMAX");

  const d13 = page.locator("#d13");
  await d13.getByText("查看当天安排", { exact: true }).click();
  await expect(d13.locator("h3")).toHaveText("动物园与海岸：Taronga、Bondi 与 Totti's");
  await expect(d13.locator(".timeline")).toContainText("Taronga Zoo 正门");
  await expect(d13.locator(".timeline")).toContainText("天气好 · 14:30–16:50");
  await expect(d13.locator(".timeline")).toContainText("Totti's Bondi 17:30（已订）");

  const d14 = page.locator("#d14");
  await d14.getByText("查看当天安排", { exact: true }).click();
  await expect(d14.locator("h3")).toHaveText("南海岸环线：Sea Cliff Bridge、Kiama 与 Kangaroo Valley");
  await expect(d14.locator(".timeline")).toContainText("SIXT Sydney City");
  await expect(d14.locator(".timeline")).toContainText("Werri Beach");
  await expect(d14.locator(".timeline")).toContainText("15:30 前驶离袋鼠谷");
  await expect(d14.locator(".timeline")).toContainText("18:50 前完成");
  await expect(d14.getByRole("region", { name: "每日地图快捷入口" }).getByRole("link", { name: "打开第一站" })).toHaveAttribute("href", /waypoints=.*Bald.*Sea.*Kiama.*Werri.*Hampden/i);

  const d15 = page.locator("#d15");
  await d15.getByText("查看当天安排", { exact: true }).click();
  await expect(d15.locator("h3")).toHaveText("悉尼告别日：Bondi 补位、Manly 备选与 Cafe Sydney");
  await expect(d15.locator(".timeline")).toContainText("若 8/10 没去成 Bondi");
  await expect(d15.locator(".timeline")).toContainText("Manly 不再安排");
  await expect(d15.locator(".timeline")).toContainText("Cafe Sydney");
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
  await expect(d15.locator("h3")).toHaveText("悉尼告别日：Bondi 补位、Manly 备选与 Cafe Sydney");
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
