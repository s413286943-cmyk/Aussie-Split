import { expect, test } from "./fixtures/test.js";

test.use({ serviceWorkers: "allow" });

test("cached ledger routes reopen offline and retain a locally added expense", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(new Date("2026-07-20T10:00:00+08:00"));
  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Harbour dinner" })).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  try {
    await page.goto("/itinerary", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "今日旅行控制台" })).toBeVisible();
    await expect(page.getByText("本机缓存 · 可能不是最新", { exact: true })).toBeVisible();

    await page.goto("/add", { waitUntil: "domcontentloaded" });
    await page.getByLabel("项目").fill("Offline tram");
    await page.getByLabel("日期").fill("2026-07-30");
    await page.getByLabel("币种").selectOption("AUD");
    await page.getByLabel("金额").fill("12.5");
    await page.getByRole("button", { name: "保存", exact: true }).click();

    await expect(page).toHaveURL(/\/expenses\?highlight=/);
    await expect(page.getByRole("heading", { name: "Offline tram" })).toBeVisible();
    await expect(page.getByText(/已本机保存，待同步（1）/).first()).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Offline tram" })).toBeVisible();
    await expect(page.getByText("A$12.50", { exact: true })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
