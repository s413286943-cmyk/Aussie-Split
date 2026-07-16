import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

function workspaceUrl(path) {
  return new URL(path, root);
}

function readWorkspaceFile(path) {
  return readFileSync(workspaceUrl(path), "utf8");
}

describe("removed travel assistant", () => {
  it("keeps the AI brief panel and protected assistant API out of the app", () => {
    const todayConsole = readWorkspaceFile("src/components/itinerary/TodayConsole.jsx");
    const apiClient = readWorkspaceFile("src/lib/apiClient.js");

    assert.doesNotMatch(todayConsole, /TravelAssistantPanel|今日节奏与取舍|AI 行程调度/);
    assert.doesNotMatch(apiClient, /requestTravelBrief|requestTravelChat|\/api\/travel-assistant/);
    assert.equal(existsSync(workspaceUrl("src/components/itinerary/TravelAssistantPanel.jsx")), false);
    assert.equal(existsSync(workspaceUrl("src/app/api/travel-assistant/route.ts")), false);
  });
});
