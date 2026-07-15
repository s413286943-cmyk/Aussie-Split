import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TravelAssistantProviderError,
  readTravelAssistantConfig,
  requestTravelBrief,
} from "../src/lib/server/travelAssistantProvider.js";

const env = {
  TRAVEL_AI_API_KEY: "provider-test-secret",
  TRAVEL_AI_BASE_URL: "https://provider.example",
  TRAVEL_AI_MODEL: "gpt-5-mini",
};

const systemPrompt = "You are a travel operations advisor. Return only JSON matching the requested schema. Select only supplied fact IDs and checklist IDs. Do not invent or restate exact times, dates, bookings, prices, people, or places. Reasons must be generic and concise. Hard facts remain controlled by the website.";

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

  it("requests JSON object output and parses the message content", async () => {
    const context = { day: { id: "d14" } };
    const calls = [];
    const output = await requestTravelBrief({
      context,
      env,
      fetcher: async (url, options) => {
        calls.push({ url: String(url), options });
        return Response.json({ choices: [{ message: { content: "{\"pace\":{}}" } }] });
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
      "response_format",
      "messages",
    ]);
    assert.equal(body.model, "gpt-5-mini");
    assert.equal(body.temperature, 0.2);
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
});
