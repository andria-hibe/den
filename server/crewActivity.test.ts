import { describe, expect, it } from "vitest";
import { runningAgents } from "./crewActivity.ts";

const line = (event: string, id: string, type = "badger") =>
  JSON.stringify({ hook_event_name: event, agent_id: id, agent_type: type, transcript_path: "/p/s1.jsonl" });

describe("runningAgents", () => {
  it("keeps agents started and not yet stopped", () => {
    const log = [
      line("SubagentStart", "a1", "badger"),
      line("SubagentStart", "a2", "owl"),
      "{not json",
      line("SubagentStop", "a1", "badger"),
      "",
    ].join("\n");
    expect(runningAgents(log)).toEqual([{ id: "a2", type: "owl", transcript: "/p/s1/subagents/agent-a2.jsonl" }]);
  });
});
