import { expect, test } from "./fixtures/test.js";

test("dashboard previews three recent operations and the activity page shows the full feed", async ({ page }) => {
  await page.goto("/");

  const preview = page.locator("section.activity-section");
  await expect(preview.locator(".activity-row")).toHaveCount(3);
  await expect(preview.getByText("5 条", { exact: true })).toBeVisible();
  await preview.getByRole("link", { name: "全部" }).click();

  await expect(page).toHaveURL(/\/activity$/);
  const fullFeed = page.locator("section.activity-page");
  await expect(fullFeed.locator(".activity-row")).toHaveCount(5);
  await expect(fullFeed.getByRole("heading", { name: "最近操作" })).toBeVisible();
});

test("backup panel exports data and surfaces invalid and valid import previews", async ({ page }) => {
  await page.goto("/activity");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出备份" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^aussie-chill-ledger-\d{4}-\d{2}-\d{2}\.json$/);

  const fileInput = page.locator(".backup-panel input[type='file']");
  await fileInput.setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });
  await expect(page.locator(".backup-panel [role='alert']")).toHaveText("备份文件不是有效的 JSON");

  await fileInput.setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(validBackup())),
  });
  const preview = page.locator(".backup-preview");
  await expect(preview).toContainText("可合并");
  await expect(preview).toContainText("1 条");
  await expect(preview).toContainText("A$25.00");
  await preview.getByRole("button", { name: "合并备份" }).click();
  await expect(page.locator(".action-toast")).toContainText("已合并 1 条备份记录");

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Imported coffee" })).toBeVisible();
});

function validBackup() {
  return {
    kind: "aussie-chill-ledger-backup",
    schemaVersion: 1,
    exportedAt: "2026-07-12T00:00:00.000Z",
    activityCount: 0,
    expenses: [{
      id: "expense-imported-coffee",
      category: "dining",
      item: "Imported coffee",
      date: "2026-08-10",
      currency: "AUD",
      amount: 25,
      payer: "us",
      status: "confirmed",
      note: "Backup fixture",
      splitSettled: false,
      updatedAt: "2026-07-12T00:00:00.000Z",
      deletedAt: null,
    }],
  };
}
