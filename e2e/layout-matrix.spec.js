import { expect, test } from "./fixtures/test.js";
import { documentOverflowsHorizontally, findClippedText } from "./fixtures/layout.js";

const routes = ["/", "/expenses", "/add", "/activity", "/settlement", "/itinerary"];
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1200, height: 900 },
  { width: 1440, height: 1000 },
];

test("primary routes remain bounded across the responsive matrix", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-30T10:00:00+08:00"));
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
      expect(await documentOverflowsHorizontally(page), `${route} overflows at ${viewport.width}px`).toBe(false);
      expect(await findClippedText(page), `${route} clips text at ${viewport.width}px`).toEqual([]);
    }
  }
});

test("desktop shells do not render a decorative guide rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const [route, selector] of [["/", ".docket-shell"], ["/itinerary", ".route-atlas"]]) {
    await page.goto(route);
    const guideContent = await page.locator(selector).evaluate((element) => (
      getComputedStyle(element, "::before").content
    ));
    expect(guideContent, `${route} still renders its left guide rail`).toBe("none");
  }
});
