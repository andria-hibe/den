import { describe, it, expect } from "vitest";
import { churnFromGuide, isChurnPath } from "../../shared/churn.ts";
import { fileKind, parseGitAttributes, prSize } from "../../shared/fileKind.ts";

describe("isChurnPath", () => {
  it("spots lockfiles, snapshots, and generated code", () => {
    for (const p of ["package-lock.json", "app/Gemfile.lock", "pnpm-lock.yaml", "src/__snapshots__/a.test.ts.snap", "src/__generated__/graphql.ts", "apps/rails/db/schema.rb", "x/app.min.js"]) {
      expect(isChurnPath(p)).toBe(true);
    }
  });
  it("leaves source alone", () => {
    for (const p of ["src/plugins/auth.ts", "lib/generator.rb", "src/gen.ts", "package.json"]) {
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

describe("fileKind and prSize", () => {
  const rules = parseGitAttributes(
    "# generated\napps/meta/query_collections.yaml linguist-generated=true\npackages/**/generated/*.gen.ts linguist-generated\nvendor/keep.js -linguist-generated\n*.snap review-test\n",
  );

  it("lets the repo's .gitattributes win over den's path guesses", () => {
    expect(fileKind("apps/meta/query_collections.yaml", rules)).toBe("generated");
    expect(fileKind("packages/a/b/generated/x.gen.ts", rules)).toBe("generated");
    expect(fileKind("vendor/keep.js", rules)).toBe("implementation");
    expect(fileKind("deep/a.snap", rules)).toBe("test");
    expect(fileKind("server/app.test.ts")).toBe("test");
    expect(fileKind("spec/models/user_spec.rb")).toBe("test");
    expect(fileKind("docs/architecture.md")).toBe("docs");
    expect(fileKind("package-lock.json")).toBe("generated");
    expect(fileKind("server/app.ts")).toBe("implementation");
  });

  it("counts implementation lines, or the totals when GitHub cut the file list", () => {
    const files = [
      { path: "server/app.ts", additions: 10, deletions: 2 },
      { path: "server/app.test.ts", additions: 50, deletions: 0 },
    ];
    expect(prSize(files, { additions: 60, deletions: 2, changedFiles: 2 })).toMatchObject({ implAdditions: 10, implDeletions: 2, partial: false });
    expect(prSize(files, { additions: 900, deletions: 40, changedFiles: 150 })).toMatchObject({ implAdditions: 900, implDeletions: 40, partial: true });
  });
});
