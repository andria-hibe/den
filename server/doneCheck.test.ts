import { describe, expect, it } from "vitest";
import { DONE_CHECK_MAX_VERIFY, DONE_CHECK_SCRIPT, doneCheckPrompt } from "./doneCheck.ts";
import { isAscii } from "../shared/ascii.ts";

type Opts = { label?: string; agentType?: string; schema?: unknown };
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** Runs the workflow script against fake hooks: `answer` plays every agent. */
function run(answer: (prompt: string, opts: Opts) => unknown, args: unknown = {}) {
  const body = DONE_CHECK_SCRIPT.replace(/^export const meta/, "const meta");
  const fn = new AsyncFunction("agent", "parallel", "pipeline", "phase", "log", "args", body);
  const agent = async (p: string, o: Opts) => answer(p, o);
  const parallel = async (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const pipeline = async (items: unknown[], ...stages: ((r: unknown, item: unknown, i: number) => unknown)[]) =>
    Promise.all(
      items.map(async (item, i) => {
        let r: unknown = item;
        for (const [n, stage] of stages.entries()) r = await stage(n === 0 ? item : r, item, i);
        return r;
      }),
    );
  return fn(agent, parallel, pipeline, () => {}, () => {}, args);
}

describe("done check workflow", () => {
  it("calls the helpers the change needs, double-checks serious findings up to the limit, and ranks them", async () => {
    const asked: string[] = [];
    const finding = (severity: string, where: string) => ({ severity, where, problem: "p", fix: "f" });
    const out = await run((_p, o) => {
      if (o.label === "scope") return { base: "main", summary: "s", files: ["a.ts"], performance: false, security: true };
      if (o.agentType) {
        asked.push(o.agentType);
        if (o.agentType === "badger") return { findings: [finding("low", "a.ts:1"), finding("high", "a.ts:2")], checked: "c" };
        if (o.agentType === "owl") return { findings: Array.from({ length: 6 }, (_, i) => finding("medium", `b.ts:${i}`)), checked: "c" };
        return { findings: [finding("high", "wrong.ts:9")], checked: "c" };
      }
      return { refuted: o.label!.includes("wrong.ts"), reason: "r" };
    });
    expect(asked.sort()).toEqual(["badger", "owl", "wolf"]);
    const verified = [...out.confirmed, ...out.refuted].length;
    expect(verified).toBe(DONE_CHECK_MAX_VERIFY);
    expect(out.unverified.filter((f: { capped: boolean }) => f.capped)).toHaveLength(9 - 1 - DONE_CHECK_MAX_VERIFY);
    expect(out.confirmed[0].severity).toBe("high");
    // The double-checks go to the most serious findings, whoever reported them.
    expect(out.unverified.some((f: { severity: string; capped: boolean }) => f.capped && f.severity === "high")).toBe(false);
    expect(out.unverified.some((f: { severity: string }) => f.severity === "low")).toBe(true);
  });

  it("is plain ASCII", () => {
    expect(isAscii(DONE_CHECK_SCRIPT)).toBe(true);
    expect(isAscii(doneCheckPrompt("main"))).toBe(true);
  });
});
