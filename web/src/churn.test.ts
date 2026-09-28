import { describe, it, expect } from "vitest";
import { churnFromGuide, isChurnPath } from "./churn.ts";

describe("isChurnPath", () => {
  it("spots lockfiles, snapshots, and generated code", () => {
    for (const p of ["package-lock.json", "apps/rails/Gemfile.lock", "pnpm-lock.yaml", "src/__snapshots__/a.test.ts.snap", "src/__generated__/graphql.ts", "apps/rails/db/schema.rb", "x/app.min.js"]) {
      expect(isChurnPath(p)).toBe(true);
    }
  });
  it("leaves source alone", () => {
    for (const p of ["apps/api/src/plugins/auth.ts", "lib/generator.rb", "src/gen.ts", "package.json"]) {
      expect(isChurnPath(p)).toBe(false);
    }
  });
});

describe("churnFromGuide", () => {
  it("takes the files of sections titled as churn", () => {
    const set = churnFromGuide([
      { title: "Core: the permission check", files: ["a.ts"] },
      { title: "Churn: lockfile and snapshots", files: ["yarn.lock", "b.snap"] },
      { title: "Formatting-only changes", files: ["c.ts"] },
    ]);
    expect([...set]).toEqual(["yarn.lock", "b.snap", "c.ts"]);
  });
});
