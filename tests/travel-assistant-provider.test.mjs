import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TravelAssistantProviderError,
  readTravelAssistantConfig,
  requestTravelBrief,
  requestTravelChat,
} from "../src/lib/server/travelAssistantProvider.js";

const env = {
  TRAVEL_AI_API_KEY: "provider-test-secret",
  TRAVEL_AI_BASE_URL: "https://provider.example",
  TRAVEL_AI_MODEL: "gpt-5-mini",
};

const systemPrompt = "You are a travel operations advisor. Return only JSON matching the requested schema. Write all user-facing prose in Simplified Chinese. Select only supplied fact IDs and checklist IDs. Do not invent or restate exact times, dates, bookings, prices, people, or places. Reasons must be generic and concise. Hard facts remain controlled by the website.";
const chatSystemPrompt = "Answer from the supplied itinerary context only. Write all user-facing prose in Simplified Chinese. Give advice, never claim to change itinerary, bookings, tickets, checklist, ledger, or receipts. Do not invent exact times, dates, prices, people, bookings, or places. If the context does not contain an answer, say so. Hard facts shown by the website are authoritative.";

describe("travel assistant provider", () => {
  it("is server-only and reads only the three server environment names", () => {
    const source = readFileSync(
      new URL("../src/lib/server/travelAssistantProvider.js", import.meta.url),
      "utf8",
    );
    assert.match(source, /^import ["']server-only["'];/m);

    const reads = [];
    const trackedEnv = new Proxy(env, {
      get(target, property, receiver) {
        reads.push(property);
        return Reflect.get(target, property, receiver);
      },
    });

    assert.deepEqual(readTravelAssistantConfig(trackedEnv), {
      apiKey: "provider-test-secret",
      baseUrl: "https://provider.example",
      model: "gpt-5-mini",
    });
    assert.deepEqual(new Set(reads), new Set([
      "TRAVEL_AI_API_KEY",
      "TRAVEL_AI_BASE_URL",
      "TRAVEL_AI_MODEL",
    ]));
  });

  it("normalizes a trailing slash and safely rejects invalid configuration", () => {
    assert.equal(readTravelAssistantConfig({
      ...env,
      TRAVEL_AI_BASE_URL: "https://provider.example/",
    }).baseUrl, "https://provider.example");

    const invalidEnvironments = [
      { ...env, TRAVEL_AI_API_KEY: "" },
      { ...env, TRAVEL_AI_MODEL: "" },
      { ...env, TRAVEL_AI_BASE_URL: "http://provider.example" },
      { ...env, TRAVEL_AI_BASE_URL: "https://provider-test-secret@provider.example" },
      { ...env, TRAVEL_AI_BASE_URL: "https://provider.example?detail=provider-test-secret" },
      { ...env, TRAVEL_AI_BASE_URL: "https://provider.example#provider-test-secret" },
      { ...env, TRAVEL_AI_BASE_URL: "not a URL" },
    ];

    for (const invalidEnv of invalidEnvironments) {
      assert.throws(
        () => readTravelAssistantConfig(invalidEnv),
        (error) => {
          assert.equal(error instanceof TravelAssistantProviderError, true);
          assert.equal(error.code, "provider_configuration_error");
          assert.equal(error.message, "Travel assistant provider configuration is unavailable");
          assert.equal(error.message.includes("provider-test-secret"), false);
          return true;
        },
      );
    }
  });

  it("buffers split brief SSE JSON until DONE while requesting JSON object output", async () => {
    const context = { day: { id: "d14" } };
    const calls = [];
    const output = await requestTravelBrief({
      context,
      env,
      fetcher: async (url, options) => {
        calls.push({ url: String(url), options });
        return sseResponse([
          "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"pace\\\":\"}}]}",
          "\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"{}}\"}}]}\n",
          "\ndata: [DONE]\n\n",
        ]);
      },
    });

    assert.deepEqual(output, { pace: {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://provider.example/v1/chat/completions");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers.Authorization, "Bearer provider-test-secret");
    assert.equal(calls[0].options.headers["Content-Type"], "application/json");

    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(Object.keys(body), [
      "model",
      "temperature",
      "stream",
      "response_format",
      "messages",
    ]);
    assert.equal(body.model, "gpt-5-mini");
    assert.equal(body.temperature, 0.2);
    assert.equal(body.stream, true);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.messages.length, 2);
    assert.deepEqual(body.messages[0], { role: "system", content: systemPrompt });

    const userMessage = JSON.parse(body.messages[1].content);
    assert.equal(body.messages[1].role, "user");
    assert.deepEqual(Object.keys(userMessage), ["task", "outputSchema", "context"]);
    assert.equal(userMessage.task, "daily_brief");
    assert.deepEqual(userMessage.context, context);
    assert.deepEqual(Object.keys(userMessage.outputSchema), [
      "pace",
      "priorities",
      "tradeoffs",
      "firstCut",
      "tomorrowPrepItemIds",
      "suggestedQuestions",
    ]);
    assert.equal(userMessage.outputSchema.priorities.length, 3);
    assert.equal(userMessage.outputSchema.priorities.every((priority) => (
      Object.keys(priority).join(",") === "factId,reason"
    )), true);
    assert.deepEqual(
      userMessage.outputSchema.tomorrowPrepItemIds,
      ["0-4 supplied checklist ID strings"],
    );
  });

  it("accepts a standard usage-only SSE event before brief DONE", async () => {
    const output = await requestTravelBrief({
      context: { day: { id: "d14" } },
      env,
      fetcher: async () => sseResponse([
        `data: ${JSON.stringify({
          choices: [{ delta: { content: "{\"pace\":{}}" } }],
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ]),
    });

    assert.deepEqual(output, { pace: {} });
  });

  it("rejects refused, malformed, incomplete, and invalid brief streams", async () => {
    const bodies = [
      "data: {\"choices\":[{\"delta\":{\"refusal\":\"secret refusal\"}}]}\n\ndata: [DONE]\n\n",
      "data: {not-json}\n\ndata: [DONE]\n\n",
      "data: {\"choices\":[]}\n\ndata: [DONE]\n\n",
      "data: {\"choices\":[],\"usage\":[]}\n\ndata: [DONE]\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"pace\\\":{}}\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"not-json\"}}]}\n\ndata: [DONE]\n\n",
    ];

    for (const body of bodies) {
      await assert.rejects(
        () => requestTravelBrief({
          context: { day: { id: "d14" } },
          env,
          fetcher: async () => sseResponse([body]),
        }),
        (error) => error instanceof TravelAssistantProviderError
          && error.code === "provider_unavailable"
          && error.message === "Travel assistant provider is unavailable"
          && !error.message.includes("secret refusal"),
      );
    }
  });

  it("times out while waiting for streamed brief data", async () => {
    let signal;
    let streamController;
    const body = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      pull() {
        return new Promise(() => {});
      },
    });

    await assert.rejects(
      () => requestTravelBrief({
        context: { day: { id: "d14" } },
        env,
        timeoutMs: 5,
        fetcher: async (_url, options) => {
          signal = options.signal;
          signal.addEventListener("abort", () => streamController.close(), { once: true });
          return new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      }),
      (error) => error instanceof TravelAssistantProviderError
        && error.code === "provider_timeout",
    );
    assert.equal(signal.aborted, true);
  });

  it("fails closed and cancels when many small brief events exceed the aggregate ceiling", async () => {
    let cancelled = false;
    let emitted = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      pull(controller) {
        if (emitted < 100) {
          emitted += 1;
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "x".repeat(100) } }],
            })}\n\n`,
          ));
          return undefined;
        }
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });

    await assert.rejects(
      Promise.race([
        requestTravelBrief({
          context: { day: { id: "d14" } },
          env,
          timeoutMs: 1_000,
          fetcher: async () => new Response(body),
        }),
        rejectAfter(100, "brief aggregate check hung"),
      ]),
      (error) => error instanceof TravelAssistantProviderError
        && error.code === "provider_unavailable"
        && error.message === "Travel assistant provider is unavailable"
        && !error.message.includes("brief aggregate check hung"),
    );
    assert.equal(cancelled, true);
  });

  it("does not read or expose an upstream error body", async () => {
    const response = new Response("secret upstream detail", { status: 500 });

    await assert.rejects(
      () => requestTravelBrief({ context: {}, env, fetcher: async () => response }),
      (error) => {
        assert.equal(error instanceof TravelAssistantProviderError, true);
        assert.equal(error.code, "provider_unavailable");
        assert.equal(error.message, "Travel assistant provider is unavailable");
        assert.equal(error.message.includes("secret upstream detail"), false);
        return true;
      },
    );
    assert.equal(response.bodyUsed, false);
  });

  it("maps malformed and network responses to a sanitized unavailable error", async () => {
    const fetchers = [
      async () => {
        throw new Error("secret upstream detail");
      },
      async () => Response.json({ choices: [] }),
      async () => Response.json({
        choices: [{ message: { content: "secret upstream detail" } }],
      }),
    ];

    for (const fetcher of fetchers) {
      await assert.rejects(
        () => requestTravelBrief({ context: {}, env, fetcher }),
        (error) => error instanceof TravelAssistantProviderError
          && error.code === "provider_unavailable"
          && error.message === "Travel assistant provider is unavailable"
          && !error.message.includes("secret upstream detail"),
      );
    }
  });

  it("aborts after the configured timeout", async () => {
    let signal;

    await assert.rejects(
      () => requestTravelBrief({
        context: {},
        env,
        timeoutMs: 5,
        fetcher: async (_url, options) => new Promise((_resolve, reject) => {
          signal = options.signal;
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      }),
      (error) => error instanceof TravelAssistantProviderError
        && error.code === "provider_timeout"
        && error.message === "Travel assistant provider timed out",
    );
    assert.equal(signal.aborted, true);
  });

  it("buffers split upstream SSE lines until DONE and sends current-day chat context", async () => {
    const context = { scope: "today", sourceDayIds: ["d14"], day: { id: "d14" } };
    const history = [
      { role: "user", content: "上一问" },
      { role: "assistant", content: "上一答" },
    ];
    const calls = [];
    const answer = await requestTravelChat({
      context,
      question: "下雨怎么调整？",
      history,
      env,
      fetcher: async (url, options) => {
        calls.push({ url: String(url), options });
        return sseResponse([
          "data: {\"choices\":[{\"delta\":{\"content\":\"下雨",
          "时\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"先缩短户外段。\"}}]}\n",
          "\ndata: [DONE]\n\n",
        ]);
      },
    });

    assert.equal(answer, "下雨时先缩短户外段。");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://provider.example/v1/chat/completions");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, "gpt-5-mini");
    assert.equal(body.temperature, 0.2);
    assert.equal(body.stream, true);
    assert.equal("response_format" in body, false);
    assert.deepEqual(body.messages, [
      { role: "system", content: chatSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({ task: "travel_chat_context", context }),
      },
      ...history,
      { role: "user", content: "下雨怎么调整？" },
    ]);
  });

  it("rejects upstream refusals, malformed chunks, and streams without DONE", async () => {
    const bodies = [
      "data: {\"choices\":[{\"delta\":{\"refusal\":\"secret refusal\"}}]}\n\ndata: [DONE]\n\n",
      "data: {not-json}\n\ndata: [DONE]\n\n",
      "data: {\"choices\":[]}\n\ndata: [DONE]\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
    ];

    for (const body of bodies) {
      await assert.rejects(
        () => requestTravelChat({
          context: { sourceDayIds: ["d14"] },
          question: "下雨呢？",
          history: [],
          env,
          fetcher: async () => sseResponse([body]),
        }),
        (error) => error instanceof TravelAssistantProviderError
          && error.code === "provider_unavailable"
          && !error.message.includes("secret refusal"),
      );
    }
  });

  it("times out while waiting for streamed chat data", async () => {
    let signal;
    let cancelled = false;
    const body = new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });

    await assert.rejects(
      () => requestTravelChat({
        context: { sourceDayIds: ["d14"] },
        question: "下雨呢？",
        history: [],
        env,
        timeoutMs: 5,
        fetcher: async (_url, options) => {
          signal = options.signal;
          return new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      }),
      (error) => error instanceof TravelAssistantProviderError
        && error.code === "provider_timeout",
    );
    assert.equal(signal.aborted, true);
    assert.equal(cancelled, true);
  });

  it("fails closed when delimiter-free upstream data exceeds the raw buffer ceiling", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${"x".repeat(32 * 1024)}`));
      },
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });

    await assert.rejects(
      Promise.race([
        requestTravelChat({
          context: { sourceDayIds: ["d14"] },
          question: "下雨呢？",
          history: [],
          env,
          timeoutMs: 1_000,
          fetcher: async () => new Response(body),
        }),
        rejectAfter(100, "stream buffer check hung"),
      ]),
      (error) => error instanceof TravelAssistantProviderError
        && error.code === "provider_unavailable"
        && !error.message.includes("stream buffer check hung"),
    );
    assert.equal(cancelled, true);
  });

  it("accepts one large network chunk made of small complete SSE events", async () => {
    const noContentEvent = `data: ${JSON.stringify({
      choices: [{ delta: { role: "assistant" } }],
    })}\n\n`;
    const body = [
      noContentEvent.repeat(700),
      `data: ${JSON.stringify({ choices: [{ delta: { content: "保留主线。" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    assert.equal(Buffer.byteLength(body, "utf8") > 32 * 1024, true);

    const answer = await requestTravelChat({
      context: { sourceDayIds: ["d14"] },
      question: "下雨呢？",
      history: [],
      env,
      fetcher: async () => sseResponse([body]),
    });

    assert.equal(answer, "保留主线。");
  });

  it("fails closed when one complete SSE event exceeds the raw event ceiling", async () => {
    const oversizedEvent = `data: ${JSON.stringify({
      choices: [{ delta: { role: "assistant" }, padding: "x".repeat(32 * 1024) }],
    })}\n\n`;
    const body = [
      oversizedEvent,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "不应返回。" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");

    await assert.rejects(
      () => requestTravelChat({
        context: { sourceDayIds: ["d14"] },
        question: "下雨呢？",
        history: [],
        env,
        fetcher: async () => sseResponse([body]),
      }),
      (error) => error instanceof TravelAssistantProviderError
        && error.code === "provider_unavailable",
    );
  });

  it("does not hang when the timeout fires before stream abort handling is attached", async () => {
    let signal;
    const body = new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
    });

    await assert.rejects(
      Promise.race([
        requestTravelChat({
          context: { sourceDayIds: ["d14"] },
          question: "下雨呢？",
          history: [],
          env,
          timeoutMs: 5,
          fetcher: async (_url, options) => {
            signal = options.signal;
            await new Promise((resolve) => {
              signal.addEventListener("abort", resolve, { once: true });
            });
            return new Response(body);
          },
        }),
        rejectAfter(100, "pre-aborted stream check hung"),
      ]),
      (error) => error instanceof TravelAssistantProviderError
        && error.code === "provider_timeout"
        && !error.message.includes("pre-aborted stream check hung"),
    );
    assert.equal(signal.aborted, true);
  });
});

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function rejectAfter(delayMs, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), delayMs);
  });
}
