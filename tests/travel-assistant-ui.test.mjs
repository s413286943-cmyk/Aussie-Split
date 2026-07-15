import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const todayConsoleSource = readSource("../src/components/itinerary/TodayConsole.jsx");
const panelSource = readSource("../src/components/itinerary/TravelAssistantPanel.jsx");
const styles = readSource("../src/styles/route-atlas.css");
const mobileStyles = mediaBlock(styles, "@media (max-width: 720px)");

describe("Today Console travel assistant V1", () => {
  it("renders the assistant after the ticket docket and before the field kit with only allowed props", () => {
    assert.match(
      todayConsoleSource,
      /import TravelAssistantPanel from ["'](?:@\/components\/itinerary\/|\.\/)TravelAssistantPanel["'];/,
    );
    assert.match(
      todayConsoleSource,
      /<TodayDocketStrip docket=\{docket\} \/>\s*<TravelAssistantPanel\s+day=\{day\}\s+weather=\{weather\}\s+checkedKitItems=\{checkedKitItems\}\s*\/>\s*<div className="today-field-kit"/,
    );
  });

  it("keeps the public component contract scoped to itinerary, weather, and checklist data", () => {
    assert.match(
      panelSource,
      /export default function TravelAssistantPanel\(\{ day, weather, checkedKitItems \}\)/,
    );
    assert.match(
      panelSource,
      /import \{ generateTravelBrief, streamTravelChat \} from ["']@\/lib\/apiClient["'];/,
    );
    assert.match(panelSource, /from ["']@\/lib\/travelAssistantCache["'];/);
    assert.doesNotMatch(
      panelSource,
      /ledgerExpenses|ledgerFreshness|formatMoney|receipt|supabase|payer|amount/i,
    );
  });

  it("contains the required empty, stale, and retryable error copy", () => {
    assert.match(panelSource, /生成今日简报/);
    assert.match(panelSource, /资料已更新，可重新生成/);
    assert.match(panelSource, /AI 暂不可用，原行程仍可正常查看/);
  });

  it("uses a real disabled loading button and an announced status", () => {
    assert.match(panelSource, /<button\s[\s\S]*?type="button"/);
    assert.match(panelSource, /disabled=\{loading\}/);
    assert.match(panelSource, /aria-live="polite"/);
  });

  it("generates only from the user action and guards duplicate clicks twice", () => {
    const calls = panelSource.match(/generateTravelBrief\s*\(/g) || [];
    assert.equal(calls.length, 1);
    assert.match(
      panelSource,
      /async function handleGenerate\(\) \{[\s\S]*?if \(loading \|\| inFlightRef\.current\) return;[\s\S]*?await generateTravelBrief\s*\(/,
    );
    assert.match(panelSource, /const inFlightRef = useRef\(false\);/);
    assert.doesNotMatch(
      effectSource(panelSource),
      /generateTravelBrief\s*\(/,
    );
  });

  it("keeps an old same-day response stale when the current fingerprint changed in flight", () => {
    assert.match(panelSource, /const latestFingerprintRef = useRef\(fingerprint\);/);
    assert.match(
      panelSource,
      /useLayoutEffect\(\(\) => \{\s*activeDayRef\.current = dayId;\s*latestFingerprintRef\.current = fingerprint;\s*\}, \[dayId, fingerprint\]\);/,
    );
    assert.match(panelSource, /const requestFingerprint = fingerprint;/);
    assert.match(panelSource, /fingerprint:\s*requestFingerprint,/);
    assert.match(panelSource, /if \(activeDayRef\.current !== requestDayId\) return;/);
    assert.match(
      panelSource,
      /const completionState = requestFingerprint === latestFingerprintRef\.current\s*\? "fresh"\s*:\s*"stale";/,
    );
    assert.match(
      panelSource,
      /setCacheView\(\{ dayId: requestDayId, state: completionState, entry: nextEntry \}\);/,
    );
    assert.match(
      panelSource,
      /setNotice\(completionState === "fresh" \? "generated" : "idle"\);/,
    );

    const dayGuard = panelSource.indexOf("if (activeDayRef.current !== requestDayId) return;");
    const cacheWrite = panelSource.indexOf("writeTravelBriefCache(", dayGuard);
    assert.ok(dayGuard >= 0 && cacheWrite > dayGuard, "the per-day write must follow the day-change guard");
  });

  it("renders a current-day chat disclosure only after a brief exists and keeps it closed by default", () => {
    assert.match(panelSource, /const \[chatOpen, setChatOpen\] = useState\(false\);/);
    assert.match(
      panelSource,
      /\{entry \? <TravelAssistantBrief brief=\{entry\.brief\} \/> : null\}[\s\S]*?\{entry \? \([\s\S]*?<TravelAssistantChat/,
    );
    assert.match(panelSource, /aria-expanded=\{chatOpen\}/);
    assert.match(panelSource, /继续追问/);
    assert.match(panelSource, /\{messages\.length\} 条消息/);
  });

  it("offers exactly four quick prompts plus textarea, send, and chat-only clear actions", () => {
    const quickQuestionSource = sourceBetween(
      panelSource,
      "const quickQuestions = [",
      "];",
    );
    assert.equal((quickQuestionSource.match(/^  ["'].+["'],?$/gm) || []).length, 4);
    assert.match(panelSource, /className="travel-assistant-quick-prompts"/);
    assert.match(panelSource, /<textarea[\s\S]*?value=\{chatInput\}/);
    assert.match(panelSource, /<button type="submit"[\s\S]*?>\s*发送\s*<\/button>/);
    assert.match(panelSource, /clearTravelChatCache\(browserStorage\(\), dayId\)/);
    assert.doesNotMatch(panelSource, /clearTravelBriefCache/);
  });

  it("loads and saves only local chat history and never starts chat from an effect", () => {
    assert.match(panelSource, /readTravelChatCache\(browserStorage\(\), dayId\)/);
    assert.match(panelSource, /writeTravelChatCache\(browserStorage\(\), requestDayId, nextMessages\)/);
    assert.match(panelSource, /await streamTravelChat\s*\(/);
    assert.doesNotMatch(effectSource(panelSource), /streamTravelChat\s*\(/);
  });

  it("announces pending, streaming, and error chat states without moving the input into the scroll body", () => {
    assert.match(panelSource, /aria-live=\{chatNotice === "error" \? "assertive" : "polite"\}/);
    assert.match(panelSource, /正在思考/);
    assert.match(panelSource, /正在回复/);
    assert.match(panelSource, /AI 暂时无法回答，今日简报仍可继续查看/);
    assert.match(
      panelSource,
      /className="travel-assistant-chat-body"[\s\S]*?<\/div>\s*<form className="travel-assistant-chat-form"/,
    );
  });

  it("keeps priority keys unique when the provider repeats a fact ID", () => {
    assert.match(
      panelSource,
      /key=\{`\$\{item\.factId\}-\$\{index\}`\}/,
    );
    assert.doesNotMatch(panelSource, /key=\{item\.factId\s*\|\|/);
  });

  it("uses the route-atlas panel and three-column priority contracts", () => {
    assert.match(styles, /\.travel-assistant-panel\s*\{/);
    assert.match(
      styles,
      /\.travel-assistant-panel\s*\{[\s\S]*?border-left:\s*5px solid var\(--atlas-earth\);/,
    );
    assert.match(
      styles,
      /\.travel-assistant-priorities\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/,
    );
  });

  it("stacks compactly and reserves a bounded future chat body on mobile", () => {
    assert.match(
      mobileStyles,
      /\.travel-assistant-head\s*\{[\s\S]*?flex-direction:\s*column;/,
    );
    assert.match(
      mobileStyles,
      /\.travel-assistant-priorities\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    assert.match(
      mobileStyles,
      /\.travel-assistant-questions\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/,
    );
    assert.match(
      mobileStyles,
      /\.travel-assistant-chat-body\s*\{[\s\S]*?max-height:\s*52vh;[\s\S]*?overflow-y:\s*auto;/,
    );
    assert.match(
      mobileStyles,
      /\.travel-assistant-quick-prompts\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/,
    );
  });
});

function readSource(relativePath) {
  try {
    return readFileSync(new URL(relativePath, import.meta.url), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function mediaBlock(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const next = source.indexOf("@media", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function effectSource(source) {
  const handlerStart = source.indexOf("async function handleGenerate");
  return handlerStart < 0 ? source : source.slice(0, handlerStart);
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return "";
  const end = source.indexOf(endMarker, start + startMarker.length);
  return source.slice(start + startMarker.length, end < 0 ? source.length : end);
}
