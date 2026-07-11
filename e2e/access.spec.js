import { expect, test } from "./fixtures/test.js";

test("shared access gate rejects a bad code and unlocks with the shared code", async ({ page, mockApi }) => {
  mockApi.authenticated = false;

  await page.goto("/");
  const accessCode = page.getByLabel("访问码");
  await expect(accessCode).toBeFocused();

  await accessCode.fill("wrong-code");
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page.locator("#access-code-error")).toHaveText("访问码不对或暂时无法验证");
  await expect(accessCode).toHaveAttribute("aria-invalid", "true");

  await accessCode.fill("shared-code");
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page.getByRole("heading", { name: "Aussie Chill", level: 1 })).toBeVisible();

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "费用明细", level: 1 })).toBeVisible();
});

test("public application scripts contain no private itinerary or seeded expense data", async ({ page, mockApi }) => {
  mockApi.authenticated = false;

  for (const path of ["/", "/itinerary"]) {
    await page.goto(path);
    const scriptBodies = await page.evaluate(async () => Promise.all(
      [...document.scripts]
        .map((script) => script.src)
        .filter(Boolean)
        .map((source) => fetch(source).then((response) => response.text())),
    ));
    const publicScripts = scriptBodies.join("\n");
    expect(publicScripts).not.toContain("Oaks Melbourne on Market Hotel");
    expect(publicScripts).not.toContain("Billy Tea Daintree Rainforest & Cape Tribulation Tour");
  }
});
