export async function findClippedText(page) {
  return page.evaluate(() => {
    const selectors = [
      "h1",
      "h2",
      "h3",
      "h4",
      ".focus",
      ".day-title-row > span",
      ".weather-strip p",
      ".weather-strip small",
      ".day-brief-card strong",
      ".day-brief-card small",
      ".route-stop-list span",
      ".food-brief p",
      ".food-brief small",
      ".day-execution-grid strong",
      ".day-execution-grid p",
      ".day-docket strong",
      ".day-docket small",
      ".today-summary p",
      ".today-summary small",
      ".today-status-grid strong",
      ".field-kit-head",
      ".carry-check-item strong",
      ".carry-check-item small",
      ".ledger-dock-metrics strong",
      ".ledger-dock-actions a",
      ".filter-toolbar",
      ".settlement-category-row",
      ".message-capture summary",
      ".stage-tabs button",
    ].join(",");

    return [...document.querySelectorAll(selectors)]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (!element.textContent?.trim() || rect.width < 1 || rect.height < 1) return false;
        const clipsX = ["hidden", "clip"].includes(style.overflowX)
          && element.scrollWidth > element.clientWidth + 1;
        const clipsY = ["hidden", "clip"].includes(style.overflowY)
          && element.scrollHeight > element.clientHeight + 1;
        return clipsX || clipsY;
      })
      .map((element) => ({
        selector: element.className || element.tagName.toLowerCase(),
        text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 120),
        client: [element.clientWidth, element.clientHeight],
        scroll: [element.scrollWidth, element.scrollHeight],
      }));
  });
}

export async function documentOverflowsHorizontally(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}
