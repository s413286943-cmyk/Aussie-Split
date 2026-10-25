import { expect, test } from "./fixtures/test.js";
import { documentOverflowsHorizontally, findClippedText } from "./fixtures/layout.js";

const beforeTrip = new Date("2026-11-11T10:00:00+08:00");
const duringTrip = new Date("2027-02-10T09:00:00+13:00");

test("the 2027 tab sits beside the existing itinerary and ledger", async ({ page }) => {
  await page.goto("/");
  const primary = page.getByRole("navigation", { name: "主导航" });
  await expect(primary.getByRole("link")).toHaveText(["行程", "账本", "记一笔", "2027两人"]);
  await expect(page.locator(".itinerary-shell")).toBeVisible();

  await primary.getByRole("link", { name: "2027两人" }).click();
  await expect(page).toHaveURL(/\/nz2027$/);
  await expect(page.getByRole("heading", { name: "澳新 2027", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "2027两人" })).toHaveAttribute("aria-current", "page");

  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Aussie Chill", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Harbour dinner" })).toBeVisible();
});

test("schedule shows the trip board before departure", async ({ page }) => {
  await page.clock.setFixedTime(beforeTrip);
  await page.goto("/nz2027");

  await expect(page.getByText(/距出发 \d+ 天/)).toBeVisible();
  const board = page.getByRole("region", { name: "行前清单与路线建议" });
  await expect(board.getByRole("article", { name: "住宿地址和订单" })).toContainText("免费取消至 2027/1/13 15:00");
  await expect(board.getByRole("article", { name: "出发前需要落实的事项" })).toContainText("Te Anau尾款 NZ$386.40");
  const advice = board.getByRole("article", { name: "路线建议" });
  await expect(advice.locator("details")).toHaveCount(5);
  await advice.getByText("2/15 Hobbiton当天往返约5–6小时车程").click();
  await expect(advice).toContainText("两人轮流开");
});

test("during the trip today's day is open with its drive guide and day ledger", async ({ page }) => {
  await page.clock.setFixedTime(duringTrip);
  await page.goto("/nz2027");

  const d10 = page.locator("#nz-d10");
  await expect(d10).toHaveClass(/is-current/);
  await expect(d10.locator("details")).toHaveAttribute("open", "");
  const guide = d10.getByRole("region", { name: /导航07/ });
  await expect(guide.getByRole("row")).toHaveCount(6);
  await expect(guide.getByRole("link", { name: /第一段经Crown Range、Arrowtown到Frankton/ })).toHaveAttribute("href", /google\.com\/maps\/dir/);
  await expect(d10.locator(".day-notes .is-advice")).toContainText("Crown Range");
  await expect(page.locator("#nz-d11 details")).not.toHaveAttribute("open", "");

  await d10.getByRole("link", { name: "记一笔" }).click();
  await expect(page).toHaveURL(/\/nz2027\/ledger\?date=2027-02-10$/);
  await expect(page.getByRole("form", { name: "记一笔" }).getByLabel("日期")).toHaveValue("2027-02-10");
});

test("two-person ledger adds, edits, marks paid, deletes, undoes, and stays separate from the split ledger", async ({ page, mockApi }) => {
  await page.goto("/nz2027/ledger");
  await expect(page.getByText("已同步", { exact: true })).toBeVisible();
  const nzd = page.locator(".nz27-total.currency-nzd");
  await expect(nzd.getByText("NZ$1,103.00", { exact: true })).toBeVisible();
  await expect(page.locator(".nz27-total.currency-cny")).toContainText("待付 ¥1,361.31");
  await expect(page.getByLabel("付款方")).toHaveCount(0);

  const form = page.getByRole("form", { name: "记一笔" });
  await form.getByLabel("项目").fill("E2E Kika dinner");
  await form.getByLabel("日期").fill("2027-02-09");
  await form.getByLabel("金额").fill("160");
  await form.getByLabel("状态").selectOption("pending");
  await form.getByRole("button", { name: "保存" }).click();

  const row = page.locator(".nz27-records li").filter({ hasText: "E2E Kika dinner" });
  await expect(row).toContainText("NZ$160.00");
  await expect(row).toContainText("待付");
  await expect.poll(() => mockApi.nz2027Expenses.some((item) => item.item === "E2E Kika dinner")).toBe(true);

  await row.getByRole("button", { name: "编辑" }).click();
  const edit = page.getByRole("form", { name: "编辑这笔" });
  await edit.getByLabel("金额").fill("186.5");
  await edit.getByRole("button", { name: "保存" }).click();
  await expect(row).toContainText("NZ$186.50");
  await row.getByRole("button", { name: "标为已付" }).click();
  await expect(row).not.toContainText("待付");

  const wanaka = page.getByRole("region", { name: "按城市" }).locator("li").filter({ hasText: "Wānaka" });
  await expect(wanaka).toContainText("NZ$186.50");

  await row.getByRole("button", { name: "删除" }).click();
  await expect(page.locator(".nz27-records li").filter({ hasText: "E2E Kika dinner" })).toHaveCount(0);
  await page.locator(".action-toast").getByRole("button", { name: "撤销" }).click();
  await expect(page.locator(".nz27-records li").filter({ hasText: "E2E Kika dinner" })).toBeVisible();

  const splitLedgerWrites = mockApi.requests.filter((request) => request.pathname === "/api/sync" && request.method === "POST");
  expect(splitLedgerWrites).toEqual([]);
  expect(mockApi.expenses.some((expense) => /Kika/.test(expense.item))).toBe(false);
});

test("records saved while the server is unavailable stay queued and sync later", async ({ page, mockApi }) => {
  mockApi.nz2027Available = false;
  await page.goto("/nz2027/ledger");
  const form = page.getByRole("form", { name: "记一笔" });
  await form.getByLabel("项目").fill("Queued fuel");
  await form.getByLabel("金额").fill("92.1");
  await form.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(/已本机保存，待同步（1）/)).toBeVisible();

  await page.reload();
  await expect(page.locator(".nz27-records li").filter({ hasText: "Queued fuel" })).toBeVisible();

  mockApi.nz2027Available = true;
  await page.getByRole("button", { name: "同步" }).click();
  await expect(page.getByText("已同步", { exact: true })).toBeVisible();
  expect(mockApi.nz2027Expenses.some((item) => item.item === "Queued fuel")).toBe(true);
});

test("mobile 2027 pages stay inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(duringTrip);
  for (const path of ["/nz2027", "/nz2027/ledger"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "澳新 2027", level: 1 })).toBeVisible();
    expect(await documentOverflowsHorizontally(page), path).toBe(false);
    expect(await findClippedText(page), path).toEqual([]);
  }
});

test("public scripts contain no private 2027 itinerary text", async ({ page, mockApi }) => {
  mockApi.authenticated = false;
  await page.goto("/nz2027");
  const scriptBodies = await page.evaluate(async () => Promise.all(
    [...document.scripts].map((script) => script.src).filter(Boolean).map((source) => fetch(source).then((response) => response.text())),
  ));
  const publicScripts = scriptBodies.join("\n");
  for (const secret of ["Hikuwai Haven", "15 Greenstone Place", "Mandarin Language Tour", "Twizel Holiday Park"]) {
    expect(publicScripts).not.toContain(secret);
  }
});
