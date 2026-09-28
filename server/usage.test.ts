import { describe, it, expect } from "vitest";
import { rateFor, sumUsage } from "./usage.ts";

const line = (id: string, model: string, usage: object) =>
  JSON.stringify({ type: "assistant", message: { id, model, usage } });

describe("rateFor", () => {
  it("prefers the longest matching prefix", () => {
    expect(rateFor("claude-opus-5-5")?.input).toBe(4);
    expect(rateFor("claude-opus-5")?.input).toBe(5);
    expect(rateFor("claude-fable-5-1")?.cacheRead).toBe(0.25);
    expect(rateFor("claude-fable-5")?.cacheRead).toBe(1);
  });

  it("is null for a model it doesn't know", () => {
    expect(rateFor("gpt-5")).toBeNull();
  });
});

describe("sumUsage", () => {
  it("reproduces Claude Code's own total for a real session", () => {
    // Token totals and cost from a real cost-state record (Opus 5.5, 1h cache).
    const u = sumUsage([
      line("m1", "claude-opus-5-5", {
        input_tokens: 1110,
        output_tokens: 28907,
        cache_read_input_tokens: 4964047,
        cache_creation_input_tokens: 98625,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 98625 },
      }),
    ]);
    expect(u.costUSD).toBeCloseTo(2.3643894, 6);
  });

  it("counts a message once, however many block lines repeat its usage", () => {
    const usage = { input_tokens: 10, output_tokens: 100 };
    const u = sumUsage([line("m1", "claude-sonnet-5", usage), line("m1", "claude-sonnet-5", usage)]);
    expect(u.output).toBe(100);
    expect(u.costUSD).toBeCloseTo((10 * 2 + 100 * 10) / 1e6, 12);
  });

  it("prices 5-minute cache writes at 1.25x input when no breakdown is given", () => {
    const u = sumUsage([line("m1", "claude-haiku-4-5", { cache_creation_input_tokens: 1_000_000 })]);
    expect(u.costUSD).toBeCloseTo(1.25, 9);
  });

  it("flags usage from a model with no rate instead of pricing it", () => {
    const u = sumUsage([line("m1", "some-future-model", { output_tokens: 5 })]);
    expect(u.unpriced).toBe(true);
    expect(u.costUSD).toBe(0);
  });

  it("ignores non-assistant lines and garbage", () => {
    expect(sumUsage(['{"type":"user","message":{"usage":{}}}', "not json", ""]).costUSD).toBe(0);
  });
});
