import { describe, expect, it } from "vitest";
import { DONE_CHECK_MAX_VERIFY, DONE_CHECK_SCRIPT, deepReviewPrompt, doneCheckPrompt, validCheckResult } from "./doneCheck.ts";
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
    const passes: string[] = [];
    const finding = (severity: string, where: string) => ({ severity, where, problem: "p", fix: "f" });
    const out = await run((_p, o) => {
      if (o.label === "scope") return { base: "main", summary: "s", files: ["a.ts"], performance: false, security: true, ui: false };
      if (!o.label!.startsWith("verify")) passes.push(o.label!);
      if (o.agentType) {
        asked.push(o.agentType);
        if (o.agentType === "badger") return { findings: [finding("low", "a.ts:1"), finding("high", "a.ts:2")], checked: "c" };
        if (o.agentType === "owl") return { findings: Array.from({ length: 6 }, (_, i) => finding("medium", `b.ts:${i}`)), checked: "c" };
        return { findings: [finding("high", "wrong.ts:9")], checked: "c" };
      }
      return { refuted: o.label!.includes("wrong.ts"), reason: "r" };
    });
    expect(asked.sort()).toEqual(["badger", "owl", "wolf"]);
    expect(passes.sort()).toEqual(["badger", "owl", "requirements", "tidy", "wolf"]);
    expect(out.ready).toBe(false);
    const verified = [...out.confirmed, ...out.refuted].length;
    expect(verified).toBe(DONE_CHECK_MAX_VERIFY);
    expect(out.unverified.filter((f: { capped: boolean }) => f.capped)).toHaveLength(9 - 1 - DONE_CHECK_MAX_VERIFY);
    expect(out.confirmed[0].severity).toBe("high");
    // The double-checks go to the most serious findings, whoever reported them.
    expect(out.unverified.some((f: { severity: string; capped: boolean }) => f.capped && f.severity === "high")).toBe(false);
    expect(out.unverified.some((f: { severity: string }) => f.severity === "low")).toBe(true);
  });

  it("calls a PR ready only when nothing serious is open and every helper reported", async () => {
    const scope = { base: "main", summary: "s", files: ["a.ts"], performance: false, security: false, ui: false };
    const lowOnly = { findings: [{ severity: "low", where: "a.ts:1", problem: "p", fix: "f" }], checked: "c" };
    const clean = await run((_p, o) => (o.label === "scope" ? scope : lowOnly));
    expect(clean.ready).toBe(true);
    const oneFailed = await run((_p, o) => (o.label === "scope" ? scope : o.label === "tidy" ? null : lowOnly));
    expect(oneFailed.ready).toBe(false);
  });

  it("reviews a pull request with a code-review pass, a ticket check, and badger", async () => {
    const labels: string[] = [];
    const out = await run(
      (_p, o) => {
        if (o.label === "scope") return { base: "development", summary: "s", files: ["a.ts"], performance: false, security: false };
        if (!o.label!.startsWith("verify")) {
          labels.push(`${o.label}${o.agentType ? `/${o.agentType}` : ""}`);
          return { findings: o.label === "ticket" ? [{ severity: "medium", where: "a.ts:1", problem: "p", fix: "f" }] : [], checked: "c" };
        }
        return { refuted: false, reason: "r" };
      },
      { mode: "review", base: "development" },
    );
    expect(labels.sort()).toEqual(["badger/badger", "code-review", "ticket"]);
    expect(out.confirmed[0].from).toBe("ticket");
  });

  it("is plain ASCII", () => {
    expect(isAscii(DONE_CHECK_SCRIPT)).toBe(true);
    expect(isAscii(doneCheckPrompt("main", "/r.json"))).toBe(true);
    expect(isAscii(deepReviewPrompt("main", "/r.json"))).toBe(true);
  });
});

describe("a saved check result", () => {
  it("is drawn only in the shape the view expects", () => {
    expect(validCheckResult("none")).toBeNull();
    const r = validCheckResult({ confirmed: "none", crew: {}, error: { x: 1 }, refuted: [{ severity: "odd", where: 3 }] })!;
    expect(r.confirmed).toEqual([]);
    expect(r.crew).toEqual([]);
    expect(r.error).toBeUndefined();
    expect((r.refuted as { severity: string; where: string }[])[0]).toMatchObject({ severity: "low", where: "" });
  });
});
