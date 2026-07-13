import { expect, test } from "./fixtures/test.js";

test("uploaded receipt opens through the protected receipt endpoint", async ({ page, mockApi }) => {
  Object.assign(mockApi.expenses[0], {
    attachmentName: "dinner-receipt.png",
    attachmentPath: "expense-dinner/receipt-existing.png",
    receiptId: "receipt-existing",
    attachmentStatus: "uploaded",
  });

  await page.goto("/expenses");
  const row = expenseRow(page, "Harbour dinner");
  await expect(row.getByText("有小票", { exact: true })).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await row.getByRole("button", { name: "查看小票" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/e2e\/receipt-view\?expenseId=expense-dinner$/);
  await expect(popup.getByText("mock receipt")).toBeVisible();
  expect(mockApi.requests.some((request) => request.pathname === "/api/receipts/expense-dinner")).toBe(true);
});

test("new receipt uses mocked protected contracts and never touches live Storage", async ({ page, mockApi }) => {
  await page.goto("/add");
  await page.getByLabel("项目").fill("Receipt coffee");
  await page.getByLabel("日期").fill("2026-08-10");
  await page.getByLabel("币种").selectOption("AUD");
  await page.getByLabel("金额").fill("18");
  await page.getByLabel("小票图片").setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: onePixelPng(),
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page).toHaveURL(/\/expenses\?highlight=/);
  const row = expenseRow(page, "Receipt coffee");
  await expect(row.getByText("有小票", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => mockApi.requests.filter((request) => request.pathname === "/api/receipts/finalize").length).toBeGreaterThanOrEqual(2);
  expect(mockApi.requests.some((request) => request.pathname === "/api/receipts/upload-url")).toBe(true);
  expect(mockApi.requests.some((request) => request.pathname === "/e2e/receipt-upload" && request.method === "PUT")).toBe(true);
  expect(mockApi.requests.some((request) => /supabase|\/rest\/v1|\/storage\/v1/i.test(request.url))).toBe(false);
});

test("ledger browser traffic stays same-origin and never calls Supabase Data or Storage directly", async ({ page, mockApi }) => {
  const browserRequests = [];
  page.on("request", (request) => browserRequests.push({
    method: request.method(),
    resourceType: request.resourceType(),
    url: request.url(),
  }));

  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Harbour dinner" })).toBeVisible();
  await page.goto("/expenses");
  await page.goto("/settlement");

  const origin = new URL(page.url()).origin;
  const dataRequests = browserRequests.filter((request) => ["fetch", "xhr"].includes(request.resourceType));
  expect(dataRequests.every((request) => new URL(request.url).origin === origin)).toBe(true);
  expect(browserRequests.some((request) => /supabase\.co|\/rest\/v1|\/storage\/v1/i.test(request.url))).toBe(false);
  expect(mockApi.requests.length).toBeGreaterThan(0);
  expect(mockApi.requests.every((request) => new URL(request.url).origin === origin && request.pathname.startsWith("/api/"))).toBe(true);
});

function expenseRow(page, item) {
  return page.locator(".expense-row.receipt-row").filter({
    has: page.getByRole("heading", { name: item, exact: true }),
  });
}

function onePixelPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}
