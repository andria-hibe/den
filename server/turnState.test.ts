import { describe, expect, it } from "vitest";
import { parseTurn } from "./turnState.ts";

const event = (e: Record<string, unknown>) => JSON.stringify({ session_id: "s1", ...e });
const request = event({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm run check" } });

describe("parseTurn", () => {
  it("says what a permission prompt would run, before and after its notification", () => {
    expect(parseTurn(request, 1, "s1")).toMatchObject({ state: "needs-you", detail: "Bash: npm run check" });
    // Claude Code's notification names neither the tool nor its input.
    const prompt = event({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission" });
    expect(parseTurn(prompt, 2, "s1", () => request)).toMatchObject({ state: "needs-you", detail: "Bash: npm run check" });
    expect(parseTurn(prompt, 2, "s2", () => request)).toBeNull();
  });

  it("keeps one line of how a finished turn ended", () => {
    const stop = event({ hook_event_name: "Stop", last_assistant_message: "Done.\n\n- tests pass\n" + "x".repeat(300) });
    const detail = parseTurn(stop, 1, "s1")?.detail ?? "";
    expect(detail.startsWith("Done. - tests pass")).toBe(true);
    expect(detail.length).toBeLessThanOrEqual(140);
  });
});
