import { expect, test } from "./fixtures/test.js";

test("dashboard and expense ledger load the protected snapshot", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Aussie Chill", level: 1 })).toBeVisible();
  await expect(page.getByText("A$200.00", { exact: true })).toBeVisible();
  await expect(page.getByText("A$60.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Harbour dinner" })).toBeVisible();

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "费用明细", level: 1 })).toBeVisible();
  await expect(page.locator(".expense-row.receipt-row")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Draft museum tickets" })).toBeVisible();
});

test("add, edit, split-settle, delete, and Undo work through rendered ledger controls", async ({ page }) => {
  await page.goto("/add");

  await page.getByLabel("项目").fill("E2E ferry");
  await page.getByLabel("类别").selectOption("交通");
  await page.getByLabel("日期").fill("2026-08-10");
  await page.getByLabel("币种").selectOption("AUD");
  await page.getByLabel("金额").fill("60");
  await page.getByLabel("备注").fill("Circular Quay to Manly");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page).toHaveURL(/\/expenses\?highlight=/);
  let row = expenseRow(page, "E2E ferry");
  await expect(row).toBeVisible();
  await expect(row.getByText("A$60.00", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: "编辑" }).click();
  row = page.locator(".expense-row.editing");
  await row.getByLabel("项目").fill("E2E ferry return");
  await row.getByLabel("金额").fill("100");
  await row.getByRole("button", { name: "保存", exact: true }).click();

  row = expenseRow(page, "E2E ferry return");
  await expect(row.getByText("A$100.00", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "待分摊" }).click();
  await expect(row.getByRole("button", { name: "已分摊" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "结算", exact: true }).click();
  await expect(page.getByRole("heading", { name: "结算", level: 1 })).toBeVisible();
  await expect(page.locator(".settlement-card.currency-aud").getByText("A$60.00", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "明细", exact: true }).click();
  row = expenseRow(page, "E2E ferry return");
  await row.getByRole("button", { name: "删除" }).click();
  await expect(expenseRow(page, "E2E ferry return")).toHaveCount(0);
  const notice = page.locator(".action-toast");
  await expect(notice).toContainText("已删除：E2E ferry return");
  await notice.getByRole("button", { name: "撤销" }).click();
  await expect(expenseRow(page, "E2E ferry return")).toBeVisible();
  await expect(page.locator(".action-toast")).toContainText("已恢复：E2E ferry return");
});

test("settlement excludes expenses already marked split-settled", async ({ page }) => {
  await page.goto("/settlement");

  const audSettlement = page.locator(".settlement-card.currency-aud");
  await expect(audSettlement.getByText("A$60.00", { exact: true })).toBeVisible();
  const pendingCategories = page.locator(".ledger-section .expense-row");
  await expect(pendingCategories).toContainText(["餐饮"]);
  await expect(page.locator(".ledger-section")).not.toContainText("交通");

  await page.goto("/expenses");
  const row = expenseRow(page, "Harbour dinner");
  await row.getByRole("button", { name: "待分摊" }).click();
  await expect(row.getByRole("button", { name: "已分摊" })).toBeVisible();

  await page.goto("/settlement");
  await expect(page.locator(".settlement-card.currency-aud").getByText("A$0.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前没有待分摊费用" })).toBeVisible();
});

test("mobile ledger exposes work before advanced controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

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

test("ledger and itinerary share the same primary navigation", async ({ page }) => {
  const expectedLabels = ["总览", "明细", "新增", "操作", "结算", "行程"];

  for (const path of ["/", "/itinerary"]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    const labels = await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link")
      .allTextContents();
    expect(labels).toEqual(expectedLabels);
  }
});

function expenseRow(page, item) {
  return page.locator(".expense-row.receipt-row").filter({
    has: page.getByRole("heading", { name: item, exact: true }),
  });
}
