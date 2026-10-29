import { describe, expect, it } from "vitest";
import { sharedFailures } from "./digest.ts";
import type { PullRequest } from "./github.ts";

const pr = (number: number, names: string[]) =>
  ({ number, failingChecks: names.map((name) => ({ name })) }) as unknown as PullRequest;

describe("sharedFailures", () => {
  it("names a check failing on more than one PR, and nothing failing on just one", () => {
    expect(sharedFailures([pr(1, ["Install Node Modules", "Lint"]), pr(2, ["Install Node Modules"]), pr(3, [])])).toEqual([
      { check: "Install Node Modules", prs: [1, 2] },
    ]);
  });
});
