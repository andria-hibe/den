import { defineConfig } from "vitest/config";

// Unit tests cover the pure, rule-heavy logic (security guards, PR attention
// rules, path sandboxing, title tidying) — the parts most likely to regress
// silently. They import server modules directly and run in Node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "web/**/*.test.ts"],
  },
});
