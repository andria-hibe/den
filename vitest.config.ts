import { defineConfig } from "vitest/config";

// No DOM: the tests cover pure logic only, the web code's included.
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "web/**/*.test.ts", "electron/**/*.test.ts"],
  },
});
