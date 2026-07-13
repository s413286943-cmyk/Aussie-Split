import { expect, test } from "playwright/test";

test.skip(process.env.E2E_PRODUCTION_SMOKE !== "1", "opt-in read-only production smoke");

test("production routes answer without issuing mutation requests", async ({ page, context }) => {
  const mutationRequests = [];
  await context.route("**/*", async (route) => {
    const method = route.request().method();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      mutationRequests.push({ method, url: route.request().url() });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  for (const path of ["/", "/ledger", "/expenses", "/add", "/activity", "/settlement", "/itinerary"]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${path} should answer`).toBeLessThan(400);
    await expect(page).toHaveTitle(/Aussie Chill/);
    await expect(page.getByRole("heading", { name: "Aussie Chill", level: 1 }).first()).toBeVisible();
  }

  expect(mutationRequests).toEqual([]);
});
