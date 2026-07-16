import { expect, test } from "./fixtures/test.js";
import { documentOverflowsHorizontally } from "./fixtures/layout.js";

const testNow = new Date("2026-08-11T10:00:00+08:00");
const chatAnswer = "下雨时先缩短 Bondi 海岸步道，保留 Taronga Zoo 主线。";

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

test("does not request chat until the traveler sends a question", async ({ page, mockApi }) => {
  const { assistant } = await openCurrentDay(page);

  await assistant.getByRole("button", { name: "生成今日简报" }).click();
  await expectGeneratedBrief(assistant);
  await expect(assistant.getByRole("button", { name: /继续追问.*0 条消息/ })).toBeVisible();
  expect(mockApi.assistantCallCount).toBe(1);

  await assistant.getByRole("button", { name: /继续追问.*0 条消息/ }).click();
  await expect(assistant.getByRole("button", { name: "下雨怎么调整？" })).toBeVisible();
  expect(mockApi.assistantCallCount).toBe(1);
});

test("streams a current-day answer and restores local history after reload", async ({ page, mockApi }) => {
  let { assistant } = await openCurrentDay(page);
  await generateAndOpenChat(assistant);

  await assistant.getByRole("button", { name: "下雨怎么调整？" }).click();
  await expect(assistant.getByText(chatAnswer, { exact: true })).toBeVisible();
  await expect(assistant.getByText("参考 D14", { exact: true })).toBeVisible();
  await expect(assistant.getByRole("button", { name: /继续追问.*2 条消息/ })).toBeVisible();

  const chatRequest = mockApi.getAssistantRequests().find((body) => body.mode === "chat");
  expect(chatRequest).toEqual({
    mode: "chat",
    dayId: "d14",
    weather: {
      status: "fallback",
      summary: "悉尼冬季早晚凉，渡轮甲板、动物园高处和 Bondi 海边都有风。",
      detail: "穿舒适步行鞋，薄外套随身；Bondi 海岸步道只走短段。",
      adviceLabel: "季节穿衣参考",
    },
    checkedKitItemIds: [],
    question: "下雨怎么调整？",
    history: [],
  });
  expect(JSON.stringify(chatRequest)).not.toMatch(/ledger|payer|amount|receipt|operation|supabase|private/i);

  await page.reload();
  ({ assistant } = await currentDayRegions(page));
  await assistant.getByRole("button", { name: /继续追问.*2 条消息/ }).click();
  await expect(
    assistant.locator(".travel-assistant-chat-message.is-user").getByText("下雨怎么调整？", { exact: true }),
  ).toBeVisible();
  await expect(assistant.getByText(chatAnswer, { exact: true })).toBeVisible();
  await expect(assistant.getByText("参考 D14", { exact: true })).toBeVisible();
  expect(mockApi.getAssistantRequests().filter((body) => body.mode === "chat")).toHaveLength(1);
});

test("shows the source chip before a delayed answer finishes streaming", async ({ page }) => {
  const { assistant } = await openCurrentDay(page);
  await generateAndOpenChat(assistant);

  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = typeof input === "string" ? input : input.url;
      const body = JSON.parse(options?.body || "{}");
      if (url !== "/api/travel-assistant" || body.mode !== "chat") {
        return originalFetch(input, options);
      }

      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            `event: scope\ndata: ${JSON.stringify({ scope: "day", sourceDayIds: ["d14"] })}\n\n`,
          ));
          window.__releaseAssistantChat = () => {
            controller.enqueue(encoder.encode(
              `event: delta\ndata: ${JSON.stringify({ delta: "下雨时先缩短 Bondi 海岸步道，保留 Taronga Zoo 主线。" })}\n\n`
              + "event: done\ndata: {}\n\n",
            ));
            controller.close();
          };
        },
      }), {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    };
  });

  await assistant.getByRole("button", { name: "下雨怎么调整？" }).click();
  const streamingAnswer = assistant.locator(".travel-assistant-chat-message.is-assistant");
  await expect(streamingAnswer.getByText("参考 D14", { exact: true })).toBeVisible();
  await expect(streamingAnswer.getByText("正在思考…", { exact: true })).toBeVisible();

  await page.evaluate(() => window.__releaseAssistantChat());
  await expect(streamingAnswer.getByText(chatAnswer, { exact: true })).toBeVisible();
});

test("shows server-routed day, city, and trip sources and restores them from the current-day cache", async ({ page, mockApi }) => {
  let { assistant } = await openCurrentDay(page);
  await generateAndOpenChat(assistant);
  const cases = [
    { question: "D13 怎么安排？", label: "参考 D14 · D13" },
    { question: "8月12日怎么安排？", label: "参考 D14 · D15" },
    { question: "Cairns 哪天休息？", label: "参考 D14 · D10 · D7 · D6" },
    { question: "全程哪天最累？", label: "参考 D14 + 全程索引" },
  ];

  for (const [index, testCase] of cases.entries()) {
    const textbox = assistant.getByRole("textbox", { name: "输入继续追问" });
    await textbox.fill(testCase.question);
    await assistant.getByRole("button", { name: "发送" }).click();
    const answers = assistant.locator(".travel-assistant-chat-message.is-assistant");
    await expect(answers).toHaveCount(index + 1);
    await expect(answers.nth(index).getByText(testCase.label, { exact: true })).toBeVisible();
  }

  const chatRequests = mockApi.getAssistantRequests().filter((body) => body.mode === "chat");
  expect(chatRequests.map((body) => body.question)).toEqual(cases.map((testCase) => testCase.question));
  for (const request of chatRequests) {
    expect(request.dayId).toBe("d14");
    expect(request.history.every((message) => (
      Object.keys(message).sort().join(",") === "content,role"
    ))).toBe(true);
  }

  const cached = await page.evaluate(() => ({
    d14: localStorage.getItem("aussie-chill-travel-chat-v1:d14"),
    d13: localStorage.getItem("aussie-chill-travel-chat-v1:d13"),
    d15: localStorage.getItem("aussie-chill-travel-chat-v1:d15"),
    d10: localStorage.getItem("aussie-chill-travel-chat-v1:d10"),
  }));
  expect(cached.d14).not.toBeNull();
  expect(cached.d13).toBeNull();
  expect(cached.d15).toBeNull();
  expect(cached.d10).toBeNull();
  const storedMessages = JSON.parse(cached.d14).messages;
  expect(storedMessages.filter((message) => message.role === "assistant").map((message) => ({
    scope: message.scope,
    sourceDayIds: message.sourceDayIds,
  }))).toEqual([
    { scope: "day", sourceDayIds: ["d14", "d13"] },
    { scope: "day", sourceDayIds: ["d14", "d15"] },
    { scope: "city", sourceDayIds: ["d14", "d10", "d7", "d6"] },
    { scope: "trip", sourceDayIds: ["d14"] },
  ]);

  await page.reload();
  ({ assistant } = await currentDayRegions(page));
  const disclosure = assistant.getByRole("button", { name: /继续追问.*8 条消息/ });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  for (const testCase of cases) {
    await expect(assistant.getByText(testCase.label, { exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await documentOverflowsHorizontally(page)).toBe(false);
});

test("clears only local chat while retaining the generated brief", async ({ page, mockApi }) => {
  let { assistant } = await openCurrentDay(page);
  await generateAndOpenChat(assistant);
  await assistant.getByRole("button", { name: "下雨怎么调整？" }).click();
  await expect(assistant.getByText(chatAnswer, { exact: true })).toBeVisible();

  await assistant.getByRole("button", { name: "清空对话" }).click();
  await expect(assistant.getByRole("button", { name: /继续追问.*0 条消息/ })).toBeVisible();
  await expectGeneratedBrief(assistant);

  await page.reload();
  ({ assistant } = await currentDayRegions(page));
  await expectGeneratedBrief(assistant);
  await assistant.getByRole("button", { name: /继续追问.*0 条消息/ }).click();
  await expect(assistant.getByText("选择快捷问题，或在下方输入当前行程相关问题。", { exact: true })).toBeVisible();
  expect(mockApi.getAssistantRequests().filter((body) => body.mode === "chat")).toHaveLength(1);
});

test("keeps the brief visible when a chat request fails", async ({ page, mockApi }) => {
  const { assistant } = await openCurrentDay(page);
  await generateAndOpenChat(assistant);
  mockApi.forceAssistantFailure(502);

  await assistant.getByRole("button", { name: "下雨怎么调整？" }).click();

  await expect(assistant.getByText("AI 暂时无法回答，今日简报仍可继续查看", { exact: true })).toBeVisible();
  await expectGeneratedBrief(assistant);
  await expect(assistant.getByRole("button", { name: /继续追问.*0 条消息/ })).toBeVisible();
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
  await assistant.getByRole("button", { name: /继续追问.*0 条消息/ }).click();
  await expect(assistant.getByRole("textbox", { name: "输入继续追问" })).toBeVisible();
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

async function generateAndOpenChat(assistant) {
  await assistant.getByRole("button", { name: "生成今日简报" }).click();
  await expectGeneratedBrief(assistant);
  await assistant.getByRole("button", { name: /继续追问.*0 条消息/ }).click();
  await expect(assistant.getByRole("textbox", { name: "输入继续追问" })).toBeVisible();
}
