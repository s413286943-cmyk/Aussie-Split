import { expect, test } from "./fixtures/test.js";

test("homepage opens the itinerary while the ledger overview remains available", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".itinerary-shell")).toBeVisible();
  await expect(page.getByRole("link", { name: "行程", exact: true })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "账本", exact: true }).click();
  await expect(page).toHaveURL(/\/ledger$/);

  await expect(page.getByRole("heading", { name: "澳新 2027 · 两人账本", level: 1 })).toBeVisible();
  const nzd = page.locator(".summary-card.currency-nzd");
  await expect(nzd.getByText("NZ$120.00", { exact: true })).toBeVisible();
  await expect(nzd).toContainText("已付 NZ$80.00 · 待付 NZ$40.00");
  await expect(page.locator(".summary-card.currency-aud").getByText("A$120.00", { exact: true })).toBeVisible();
  await expect(page.getByText("另有 1 条 2026 年澳洲旅行的旧记录未计入")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Harbour dinner" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Old Melbourne laneway lunch" })).toHaveCount(0);

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "费用明细", level: 1 })).toBeVisible();
  await expect(page.locator(".expense-row.receipt-row")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Draft museum tickets" })).toBeVisible();
  await expect(page.getByText(/已隐藏 1 条 2026 旧记录/)).toBeVisible();
});

test("ledger has no payer, split, or settlement controls", async ({ page }) => {
  await page.goto("/add");
  await expect(page.getByLabel("付款方")).toHaveCount(0);
  await expect(page.getByText("50/50")).toHaveCount(0);
  await expect(page.getByLabel("币种").locator("option")).toHaveText(["NZD", "CNY", "AUD"]);

  await page.goto("/expenses");
  await expect(page.getByRole("button", { name: /分摊/ })).toHaveCount(0);
  await expect(page.getByText(/付款$/)).toHaveCount(0);

  await page.goto("/settlement");
  await expect(page).toHaveURL(/\/summary$/);
});

test("add, edit, mark paid, delete, and Undo work through rendered ledger controls", async ({ page }) => {
  await page.goto("/add");

  await page.getByLabel("项目").fill("E2E Kika dinner");
  await page.getByLabel("类别").selectOption("dining");
  await page.getByLabel("日期").fill("2027-02-09");
  await page.getByLabel("币种").selectOption("NZD");
  await page.getByLabel("金额").fill("160");
  await page.getByLabel("状态").selectOption("draft");
  await page.getByLabel("备注").fill("Wānaka");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page).toHaveURL(/\/expenses\?highlight=/);
  let row = expenseRow(page, "E2E Kika dinner");
  await expect(row).toBeVisible();
  await expect(row.getByText("NZ$160.00", { exact: true })).toBeVisible();
  await expect(row.getByText("待付", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: "编辑" }).click();
  row = page.locator(".expense-row.editing");
  await row.getByLabel("项目").fill("E2E Kika dinner for two");
  await row.getByLabel("金额").fill("186.5");
  await row.getByRole("button", { name: "保存", exact: true }).click();

  row = expenseRow(page, "E2E Kika dinner for two");
  await expect(row.getByText("NZ$186.50", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "标为已付" }).click();
  await expect(row.getByText("已付", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "汇总", exact: true }).click();
  await expect(page.getByRole("heading", { name: "按天 / 城市汇总", level: 1 })).toBeVisible();
  const wanaka = page.locator(".summary-row").filter({ has: page.getByRole("heading", { name: "Wānaka", exact: true }) });
  await expect(wanaka.getByText("NZ$186.50", { exact: true })).toBeVisible();
  await expect(page.locator(".summary-row").filter({ has: page.getByRole("heading", { name: /^D09 · 02\.09/ }) })).toBeVisible();

  await page.getByRole("link", { name: "明细", exact: true }).click();
  row = expenseRow(page, "E2E Kika dinner for two");
  await row.getByRole("button", { name: "删除" }).click();
  await expect(expenseRow(page, "E2E Kika dinner for two")).toHaveCount(0);
  const notice = page.locator(".action-toast");
  await expect(notice).toContainText("已删除：E2E Kika dinner for two");
  await notice.getByRole("button", { name: "撤销" }).click();
  await expect(expenseRow(page, "E2E Kika dinner for two")).toBeVisible();
  await expect(page.locator(".action-toast")).toContainText("已恢复：E2E Kika dinner for two");
});

test("summary groups records by sleeping city and by itinerary day", async ({ page }) => {
  await page.goto("/summary");

  const city = (name) => page.locator(".summary-row").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(city("Sydney").getByText("A$120.00", { exact: true })).toBeVisible();
  await expect(city("Te Anau").getByText("NZ$80.00", { exact: true })).toBeVisible();
  await expect(city("Auckland")).toContainText("待付 NZ$40.00");
  const categories = page.locator(".category-row");
  await expect(categories).toHaveCount(3);
  for (const label of ["餐饮", "交通", "活动"]) {
    await expect(categories.filter({ has: page.getByRole("heading", { name: label, exact: true }) })).toHaveCount(1);
  }
});

test("pending filter link shows only unpaid records", async ({ page }) => {
  await page.goto("/expenses?status=draft");
  await expect(page.locator(".expense-row.receipt-row")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Draft museum tickets" })).toBeVisible();
});

test("mobile ledger exposes work before advanced controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ledger");

  await expect(page.locator(".docket-status")).toBeInViewport();
  await expect(page.locator(".docket-metrics")).toBeInViewport();

  await page.goto("/expenses");
  await expect(page.getByLabel("搜索项目或备注")).toBeVisible();
  await expect(page.locator(".advanced-filters")).toBeHidden();
  const disclosure = page.getByRole("button", { name: /更多筛选/ });
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(page.locator(".advanced-filters")).toBeVisible();

  const row = expenseRow(page, "Harbour dinner");
  await row.scrollIntoViewIfNeeded();
  const actionLayout = await row.evaluate((element) => {
    const actions = element.querySelector(".row-actions");
    const rowRect = element.getBoundingClientRect();
    const actionRect = actions.getBoundingClientRect();
    return {
      columns: getComputedStyle(actions).gridTemplateColumns.split(" ").filter(Boolean).length,
      widthRatio: actionRect.width / rowRect.width,
    };
  });
  expect(actionLayout.columns).toBe(2);
  expect(actionLayout.widthRatio).toBeGreaterThan(0.8);
});

test("mobile add keeps message recognition and templates compact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/add");

  await expect(page.locator(".message-capture")).toHaveCount(1);
  await expect(page.locator(".message-capture[open]")).toHaveCount(0);
  const templateHeight = await page.locator(".quick-templates").evaluate((element) => element.getBoundingClientRect().height);
  expect(templateHeight).toBeLessThan(64);
});

test("primary navigation separates itinerary, ledger, and quick capture", async ({ page }) => {
  const primaryDestinations = [
    ["/", "行程", "/"],
    ["/ledger", "账本", "/ledger"],
    ["/add", "记一笔", "/add"],
  ];

  for (const [path, activeLabel, href] of primaryDestinations) {
    await page.goto(path);
    const primary = page.getByRole("navigation", { name: "主导航" });
    await expect(primary.getByRole("link")).toHaveText(["行程", "账本", "记一笔"]);
    const activeLink = primary.getByRole("link", { name: activeLabel, exact: true });
    await expect(activeLink).toHaveAttribute("href", href);
    await expect(activeLink).toHaveAttribute("aria-current", "page");
  }

  await page.goto("/expenses");
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "账本" }))
    .toHaveAttribute("aria-current", "location");
});

test("ledger pages expose their own overview and reporting navigation", async ({ page }) => {
  const ledgerDestinations = [
    ["/ledger", "总览", "/ledger"],
    ["/expenses", "明细", "/expenses"],
    ["/summary", "汇总", "/summary"],
    ["/activity", "操作", "/activity"],
  ];

  for (const [path, activeLabel, href] of ledgerDestinations) {
    await page.goto(path);
    const ledgerNav = page.getByRole("navigation", { name: "账本导航" });
    await expect(ledgerNav.getByRole("link")).toHaveText(["总览", "明细", "汇总", "操作"]);
    const activeLink = ledgerNav.getByRole("link", { name: activeLabel, exact: true });
    await expect(activeLink).toHaveAttribute("href", href);
    await expect(activeLink).toHaveAttribute("aria-current", "page");
  }

  await page.goto("/add");
  await expect(page.getByRole("navigation", { name: "账本导航" })).toHaveCount(0);
});

function expenseRow(page, item) {
  return page.locator(".expense-row.receipt-row").filter({
    has: page.getByRole("heading", { name: item, exact: true }),
  });
}
