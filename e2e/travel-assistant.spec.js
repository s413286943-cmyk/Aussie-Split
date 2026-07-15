import { expect, test } from "./fixtures/test.js";
import { documentOverflowsHorizontally } from "./fixtures/layout.js";

const testNow = new Date("2026-08-11T10:00:00+08:00");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(testNow);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("does not request an assistant brief before the traveler generates one", async ({ page, mockApi }) => {
  const { assistant } = await openCurrentDay(page);

  await expect(assistant.getByRole("button", { name: "生成今日简报" })).toBeVisible();
  expect(mockApi.assistantCallCount).toBe(0);
  expect(mockApi.getAssistantRequests()).toEqual([]);
});

test("generates one brief and reuses the local cache after reload", async ({ page, mockApi }) => {
  let { assistant } = await openCurrentDay(page);

  await assistant.getByRole("button", { name: "生成今日简报" }).click();
  await expectGeneratedBrief(assistant);
  expect(mockApi.assistantCallCount).toBe(1);

  await page.reload();
  ({ assistant } = await currentDayRegions(page));
  await expectGeneratedBrief(assistant);
  expect(mockApi.assistantCallCount).toBe(1);
});

test("keeps a cached brief visible and marks it stale after a checklist change", async ({ page, mockApi }) => {
  const { assistant, checklist } = await openCurrentDay(page);

  await assistant.getByRole("button", { name: "生成今日简报" }).click();
  await expectGeneratedBrief(assistant);

  const powerItem = checklist.getByRole("checkbox", { name: /手机电量 \/ 充电宝/ });
  await powerItem.check();

  await expect(powerItem).toBeChecked();
  await expect(assistant.getByText("资料已更新，可重新生成", { exact: true })).toBeVisible();
  await expectGeneratedBrief(assistant);
  expect(mockApi.assistantCallCount).toBe(1);
});

test("keeps deterministic travel tools usable when the assistant returns 502", async ({ page, mockApi }) => {
  mockApi.forceAssistantFailure(502);
  const { assistant, checklist, ledger, ticketDocket, today } = await openCurrentDay(page);

  await assistant.getByRole("button", { name: "生成今日简报" }).click();

  await expect(assistant.getByText("AI 暂不可用，原行程仍可正常查看", { exact: true })).toBeVisible();
  await expect(today.getByText("天气参考", { exact: true })).toBeVisible();
  await expect(ticketDocket).toBeVisible();
  await expect(ledger).toBeVisible();
  await expect(ledger.getByRole("link", { name: "记餐饮" })).toHaveAttribute("href", /\/add\?/);

  const powerItem = checklist.getByRole("checkbox", { name: /手机电量 \/ 充电宝/ });
  await powerItem.check();
  await expect(powerItem).toBeChecked();
  expect(mockApi.assistantCallCount).toBe(1);
});

test("keeps empty and generated panels inside desktop and mobile viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 820 });
  const { assistant } = await openCurrentDay(page);

  expect(await documentOverflowsHorizontally(page)).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await documentOverflowsHorizontally(page)).toBe(false);

  await assistant.getByRole("button", { name: "生成今日简报" }).click();
  await expectGeneratedBrief(assistant);
  expect(await documentOverflowsHorizontally(page)).toBe(false);

  await page.setViewportSize({ width: 1366, height: 820 });
  expect(await documentOverflowsHorizontally(page)).toBe(false);
});

test("sends only the allowlisted current-day context", async ({ page, mockApi }) => {
  const { assistant, checklist } = await openCurrentDay(page);
  await checklist.getByRole("checkbox", { name: /手机电量 \/ 充电宝/ }).check();

  await assistant.getByRole("button", { name: "生成今日简报" }).click();
  await expectGeneratedBrief(assistant);

  const [body] = mockApi.getAssistantRequests();
  expect(mockApi.assistantCallCount).toBe(1);
  expect(Object.keys(body).sort()).toEqual([
    "checkedKitItemIds",
    "dayId",
    "mode",
    "weather",
  ]);
  expect(body.mode).toBe("brief");
  expect(body.dayId).toBe("d14");
  expect(body.checkedKitItemIds).toEqual(["power"]);
  expect(Object.keys(body.weather).sort()).toEqual([
    "adviceLabel",
    "detail",
    "status",
    "summary",
  ]);
  expect(body.weather).toEqual({
    status: "fallback",
    summary: "悉尼冬季早晚凉，渡轮甲板、动物园高处和 Bondi 海边都有风。",
    detail: "穿舒适步行鞋，薄外套随身；Bondi 海岸步道只走短段。",
    adviceLabel: "季节穿衣参考",
  });
  expect(JSON.stringify(body)).not.toMatch(/ledger|payer|amount|receipt|operation|supabase|private/i);
});

async function openCurrentDay(page) {
  await page.goto("/itinerary");
  return currentDayRegions(page);
}

async function currentDayRegions(page) {
  const today = page.getByRole("region", { name: "今日旅行控制台" });
  await expect(today.getByRole("heading", { name: /D14 · 08\.11 周二/ })).toBeVisible();

  const assistant = today.getByRole("region", { name: "今日节奏与取舍" });
  const checklist = today.getByRole("region", { name: "D14 不要忘清单" });
  const ledger = today.getByRole("region", { name: "D14 账本联动" });
  const ticketDocket = today.getByRole("region", { name: "今日票夹" });
  await expect(assistant).toBeVisible();

  return { assistant, checklist, ledger, ticketDocket, today };
}

async function expectGeneratedBrief(assistant) {
  await expect(assistant.getByText("Taronga Zoo", { exact: true })).toBeVisible();
  await expect(assistant.getByRole("region", { name: "今日前三优先事项" }).getByRole("article")).toHaveCount(3);
}
