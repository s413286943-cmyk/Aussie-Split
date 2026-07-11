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
  await expect(pendingCategories).toContainText(["dining"]);
  await expect(page.locator(".ledger-section")).not.toContainText("交通");

  await page.goto("/expenses");
  const row = expenseRow(page, "Harbour dinner");
  await row.getByRole("button", { name: "待分摊" }).click();
  await expect(row.getByRole("button", { name: "已分摊" })).toBeVisible();

  await page.goto("/settlement");
  await expect(page.locator(".settlement-card.currency-aud").getByText("A$0.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前没有待分摊费用" })).toBeVisible();
});

function expenseRow(page, item) {
  return page.locator(".expense-row.receipt-row").filter({
    has: page.getByRole("heading", { name: item, exact: true }),
  });
}
