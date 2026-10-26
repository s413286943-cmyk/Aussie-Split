import { expect, test } from "./fixtures/test.js";
import { documentOverflowsHorizontally, findClippedText } from "./fixtures/layout.js";

const beforeTrip = new Date("2026-11-11T10:00:00+08:00");
const duringTrip = new Date("2027-02-10T09:00:00+13:00");

test("the home page opens the 2027 trip and tucks the finished trip away", async ({ page, mockApi }) => {
  mockApi.authenticated = false;
  await page.clock.setFixedTime(beforeTrip);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "澳新 2027", level: 1 })).toBeVisible();
  await page.getByLabel("访问码").fill("shared-code");
  await page.getByRole("button", { name: "进入" }).click();

  const hero = page.getByRole("region", { name: "今天的行程" });
  await expect(hero).toContainText(/还有 \d+ 天/);
  await expect(hero.getByRole("heading", { level: 1 })).toContainText("抵达悉尼");
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link")).toHaveText(["日程", "清单24", "记账"]);

  const past = page.locator(".nz-past");
  await expect(past.getByRole("link", { name: "看那次的行程" })).toBeHidden();
  await past.locator("summary").click();
  await past.getByRole("link", { name: "看那次的行程" }).click();
  await expect(page).toHaveURL(/\/itinerary$/);
  await expect(page.locator(".itinerary-shell")).toBeVisible();
});

test("copy reads from the travellers' side, not the builders'", async ({ page }) => {
  await page.clock.setFixedTime(beforeTrip);
  for (const path of ["/", "/nz2027/checklist", "/nz2027/ledger"]) {
    await page.goto(path);
    await expect(page.locator(".nz-main")).toBeVisible();
    const text = await page.locator(".nz").innerText();
    for (const phrase of ["分账", "2026 分账", "本机", "接口", "数据库", "行程文件", "主线"]) {
      expect(text, `${path} mentions ${phrase}`).not.toContain(phrase);
    }
  }
});

test("during the trip today is the hero and its day opens with the drive guide", async ({ page }) => {
  await page.clock.setFixedTime(duringTrip);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const hero = page.getByRole("region", { name: "今天的行程" });
  await expect(hero).toContainText("今天 · DAY 10 · 2月10日 周三");
  await expect(hero).toContainText("第 10 天 / 17");
  await expect(hero.locator(".nz-hero-stay")).toHaveText("今晚住 Te Anau");
  await expect(page.locator(".nz-cities li.is-here")).toContainText("Te Anau");

  const d10 = page.locator("#nz-d10");
  await expect(d10).toHaveClass(/is-today/);
  await expect(d10.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  const guide = d10.getByRole("region", { name: /导航07/ });
  await expect(guide.getByRole("row")).toHaveCount(6);
  await expect(guide.getByRole("link", { name: /第一段经Crown Range、Arrowtown到Frankton/ })).toHaveAttribute("href", /google\.com\/maps\/dir/);
  await expect(page.locator("#nz-d11 .nz-day-body")).toHaveCount(0);

  await page.locator("#nz-d11 .nz-day-head").click();
  await expect(page.locator("#nz-d11 .nz-day-body")).toContainText("RealNZ");

  await d10.getByRole("link", { name: "记一笔" }).click();
  await expect(page).toHaveURL(/\/nz2027\/ledger\?date=2027-02-10$/);
  await expect(page.getByRole("form", { name: "记一笔" }).getByLabel("日期")).toHaveValue("2027-02-10");
});

test("checklist items can be ticked off and the tick syncs", async ({ page, mockApi }) => {
  await page.clock.setFixedTime(beforeTrip);
  await page.goto("/nz2027/checklist");

  await expect(page.getByRole("region", { name: "清单进度" })).toContainText("0 / 24 已办完");
  const visa = page.locator(".nz-check").filter({ hasText: "办澳大利亚、新西兰签证" });
  await visa.locator("label").click();
  await expect(visa).toHaveClass(/is-done/);
  await expect(visa.locator("strong")).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByRole("region", { name: "清单进度" })).toContainText("1 / 24 已办完");
  await expect.poll(() => mockApi.nz2027Checklist.find((item) => item.id === "visa")?.done).toBe(true);

  await page.getByLabel("隐藏已办完的").check();
  await expect(visa).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: /清单/ })).toContainText("23");
});

test("ticks made on the other phone show up here", async ({ page, mockApi }) => {
  mockApi.nz2027Checklist = [{ id: "late-checkin-chc", done: true, updatedAt: "2026-11-02T00:00:00.000Z" }];
  await page.clock.setFixedTime(beforeTrip);
  await page.goto("/nz2027/checklist");
  await expect(page.locator(".nz-check").filter({ hasText: "拿到基督城 Metropolitan 的晚到入住方式" })).toHaveClass(/is-done/);
});

test("two-person ledger adds, edits, marks paid, deletes and undoes, apart from the 2026 ledger", async ({ page, mockApi }) => {
  await page.goto("/nz2027/ledger");
  await expect(page.getByText("已同步", { exact: true })).toBeVisible();
  await expect(page.locator(".nz-total.currency-nzd").getByText("NZ$1,103.00", { exact: true })).toBeVisible();
  await expect(page.locator(".nz-total.currency-cny")).toContainText("待付 ¥1,361.31");

  const form = page.getByRole("form", { name: "记一笔" });
  await form.getByLabel("项目").fill("E2E Kika dinner");
  await form.getByLabel("日期").fill("2027-02-09");
  await form.getByLabel("金额").fill("160");
  await form.getByLabel("状态").selectOption("pending");
  await form.getByRole("button", { name: "保存" }).click();

  const row = page.locator(".nz-records li").filter({ hasText: "E2E Kika dinner" });
  await expect(row).toContainText("NZ$160.00");
  await expect(row).toContainText("待付");
  await expect.poll(() => mockApi.nz2027Expenses.some((item) => item.item === "E2E Kika dinner")).toBe(true);

  await row.getByRole("button", { name: "编辑" }).click();
  const edit = page.getByRole("form", { name: "改这一笔" });
  await edit.getByLabel("金额").fill("186.5");
  await edit.getByRole("button", { name: "保存" }).click();
  await expect(row).toContainText("NZ$186.50");
  await row.getByRole("button", { name: "标为已付" }).click();
  await expect(row).not.toContainText("待付");

  await expect(page.getByRole("region", { name: "按城市" }).locator("li").filter({ hasText: "Wānaka" })).toContainText("NZ$186.50");

  await row.getByRole("button", { name: "删除" }).click();
  await expect(page.locator(".nz-records li").filter({ hasText: "E2E Kika dinner" })).toHaveCount(0);
  await page.locator(".nz-toast").getByRole("button", { name: "撤销" }).click();
  await expect(page.locator(".nz-records li").filter({ hasText: "E2E Kika dinner" })).toBeVisible();

  expect(mockApi.requests.filter((request) => request.pathname === "/api/sync" && request.method === "POST")).toEqual([]);
  expect(mockApi.expenses.some((expense) => /Kika/.test(expense.item))).toBe(false);
});

test("records saved without signal stay on the phone and sync later", async ({ page, mockApi }) => {
  mockApi.nz2027Available = false;
  await page.goto("/nz2027/ledger");
  const form = page.getByRole("form", { name: "记一笔" });
  await form.getByLabel("项目").fill("Queued fuel");
  await form.getByLabel("金额").fill("92.1");
  await form.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(/1 笔/).first()).toBeVisible();
  await expect(page.locator(".nz-ledger-sync")).toContainText("没连上");

  await page.reload();
  await expect(page.locator(".nz-records li").filter({ hasText: "Queued fuel" })).toBeVisible();

  mockApi.nz2027Available = true;
  await page.getByRole("button", { name: "立即同步" }).click();
  await expect(page.getByText("已同步", { exact: true })).toBeVisible();
  expect(mockApi.nz2027Expenses.some((item) => item.item === "Queued fuel")).toBe(true);
});

test("phone layout keeps the tab bar at the bottom and nothing overflows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(duringTrip);
  for (const path of ["/", "/nz2027/checklist", "/nz2027/ledger"]) {
    await page.goto(path);
    await expect(page.locator(".nz-main")).toBeVisible();
    const tabs = await page.getByRole("navigation", { name: "主导航" }).boundingBox();
    expect(tabs.y, `${path} tab bar position`).toBeGreaterThan(700);
    expect(await documentOverflowsHorizontally(page), path).toBe(false);
    expect(await findClippedText(page), path).toEqual([]);
  }
});

test("public scripts contain no private 2027 itinerary text", async ({ page, mockApi }) => {
  mockApi.authenticated = false;
  await page.goto("/");
  const scriptBodies = await page.evaluate(async () => Promise.all(
    [...document.scripts].map((script) => script.src).filter(Boolean).map((source) => fetch(source).then((response) => response.text())),
  ));
  const publicScripts = scriptBodies.join("\n");
  for (const secret of ["Hikuwai Haven", "15 Greenstone Place", "Mandarin Language Tour", "Twizel Holiday Park"]) {
    expect(publicScripts).not.toContain(secret);
  }
});
