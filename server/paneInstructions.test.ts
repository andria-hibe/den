import { describe, it, expect } from "vitest";
import {
  houseRules,
  isAscii,
  lookInstruction,
  myPrInstruction,
  denIssueRule,
  reviewInstruction,
  testingRules,
  commentRules,
  workspaceInstruction,
  managerInstruction,
  managerRelayRule,
  buildManagerPermissions,
  clockOutBlockers,
} from "./sessions.ts";
import { crewRule, kitAgents, managerAgents } from "./crew.ts";

const NOTEPAD = "/Users/x/.den/progress/abc-123.md";

describe("houseRules", () => {
  const rules = houseRules();

  it("is pure ASCII and demands ASCII output", () => {
    expect(isAscii(rules)).toBe(true);
    expect(rules).toContain("plain ASCII");
  });

  it("opens every PR as a draft and never marks one ready", () => {
    expect(rules).toContain("--draft");
    expect(rules).toContain("gh pr create");
    expect(rules).toContain("Never run `gh pr ready`");
  });
});

describe("workspaceInstruction", () => {
  const text = workspaceInstruction(NOTEPAD);

  it("keeps the notepad wiring and adds the house rules", () => {
    expect(isAscii(text)).toBe(true);
    expect(text).toContain(NOTEPAD);
    expect(text).toContain("Read it before you start");
    expect(text).toContain(houseRules());
  });
});

describe("myPrInstruction", () => {
  const text = myPrInstruction(123, "org/repo", "andria/fast-1-thing");

  it("names the PR, the repo, and the branch", () => {
    expect(isAscii(text)).toBe(true);
    expect(text).toContain("pull request #123 (org/repo)");
    expect(text).toContain("branch andria/fast-1-thing");
  });

  it("carries the house rules, since its replies reach GitHub", () => {
    expect(text).toContain(houseRules());
    expect(text).toContain("don't post to GitHub yourself");
  });

  it("still reads when the PR context is missing", () => {
    const bare = myPrInstruction(null, null, null);
    expect(isAscii(bare)).toBe(true);
    expect(bare).toContain("the developer's own pull request, inside");
  });
});

describe("lookInstruction", () => {
  const text = lookInstruction("FAST-1234", "Fix the thing", NOTEPAD);

  it("names the ticket and points at the saved description", () => {
    expect(isAscii(text)).toBe(true);
    expect(text).toContain("FAST-1234: Fix the thing");
    expect(text).toContain(NOTEPAD);
    expect(text).toContain("don't edit it");
  });

  it("carries the house rules", () => {
    expect(text).toContain(houseRules());
  });
});

describe("testingRules and commentRules", () => {
  it("are ASCII and reach the panes that write code, not the one that only reads", () => {
    for (const rules of [testingRules(), commentRules()]) {
      expect(isAscii(rules)).toBe(true);
      expect(workspaceInstruction("/n.md")).toContain(rules);
      expect(myPrInstruction(1, "o/r", "b")).toContain(rules);
      expect(lookInstruction("T-1", "t", "/n.md")).not.toContain(rules);
    }
  });
});

describe("denIssueRule", () => {
  it("is ASCII and reaches every pane kind, review included", () => {
    const rule = denIssueRule();
    expect(isAscii(rule)).toBe(true);
    expect(rule).toContain("gh issue create --repo");
    expect(rule).toContain("is public");
    for (const text of [
      workspaceInstruction("/n.md"),
      myPrInstruction(1, "o/r", "b"),
      lookInstruction("T-1", "t", "/n.md"),
      reviewInstruction("/n.md", "/d.diff", "b", "/g.md"),
    ]) expect(text).toContain(rule);
  });
});

describe("managerInstruction", () => {
  const text = managerInstruction(NOTEPAD, "/Users/x/.den/manager/today.md", "/Users/x/.den/manager/digest.md");

  it("is ASCII and points at the digest, the Today list, and its handover", () => {
    expect(isAscii(text)).toBe(true);
    expect(text).toContain("/Users/x/.den/manager/digest.md");
    expect(text).toContain("/Users/x/.den/manager/today.md");
    expect(text).toContain(NOTEPAD);
  });

  it("relays approvals in the form the sessions are told to accept", () => {
    const form = 'The developer said in Today at HH:MM: <their words>';
    expect(text).toContain(form);
    expect(managerRelayRule()).toContain(form);
    expect(workspaceInstruction(NOTEPAD, true)).toContain(managerRelayRule());
    expect(workspaceInstruction(NOTEPAD, false)).not.toContain(managerRelayRule());
  });

  it("is denied the writes it must never make", () => {
    const { deny } = buildManagerPermissions("/t.md", NOTEPAD).permissions;
    for (const rule of ["Bash(git push:*)", "Bash(git commit:*)", "Bash(gh pr merge:*)", "Bash(gh api:*)"]) {
      expect(deny).toContain(rule);
    }
  });
});

describe("the crew", () => {
  it("gives kits ASCII reviewers, with Owl on Fable only when the week has room", () => {
    expect(isAscii(crewRule() + JSON.stringify(kitAgents(true)) + JSON.stringify(managerAgents(true, "/d.md")))).toBe(true);
    expect(kitAgents(true).owl.model).toBe("claude-fable-5-1");
    expect(kitAgents(false).owl.model).toBe("opus");
    expect(workspaceInstruction(NOTEPAD, true)).toContain(crewRule());
  });
});

describe("clockOutBlockers", () => {
  const quiet = { pinned: false, busy: false, merging: false, staged: false, ciPending: false };

  it("ends a quiet pane, and keeps one up for each thing the sessions asked us never to cut off", () => {
    expect(clockOutBlockers(quiet)).toEqual([]);
    for (const key of Object.keys(quiet) as (keyof typeof quiet)[]) {
      expect(clockOutBlockers({ ...quiet, [key]: true })).toHaveLength(1);
    }
  });
});
