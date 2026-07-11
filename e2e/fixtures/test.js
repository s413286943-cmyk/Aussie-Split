import { test as base, expect } from "playwright/test";

import { MockApi } from "./mock-api.js";

export const test = base.extend({
  mockApi: [
    async ({ page, baseURL }, use) => {
      if (!baseURL) throw new Error("The local E2E base URL is required");
      const mockApi = new MockApi({ expectedOrigin: new URL(baseURL).origin });
      await mockApi.install(page);
      await use(mockApi);
      if (mockApi.securityViolations.length) {
        throw new Error(`Forbidden browser requests: ${mockApi.securityViolations.join(", ")}`);
      }
    },
    { auto: true },
  ],
});

export { expect };
