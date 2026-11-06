import { describe, it, expect } from "vitest";
import { parseRunnStatus, extractPort, literalIncludes, parseDockerPs, runnPortProblem } from "./apprun.ts";

describe("extractPort", () => {
  it("reads an explicit port from common flag styles", () => {
    expect(extractPort("vite --port 4000")).toBe(4000);
    expect(extractPort("vite --port=4000")).toBe(4000);
    expect(extractPort("next dev -p 3001")).toBe(3001);
    expect(extractPort("PORT=8080 node server.js")).toBe(8080);
  });

  it("returns undefined when no port is declared (no default guessing)", () => {
    expect(extractPort("vite")).toBeUndefined();
    expect(extractPort("concurrently npm:dev:server npm:dev:web")).toBeUndefined();
    // a bare -p that isn't a port flag shouldn't false-match a random number
    expect(extractPort("tsx watch server/index.ts")).toBeUndefined();
  });
});

describe("parseRunnStatus", () => {
  const running = `Project: proj-a1.example.localhost
Branch: me/abc-123
App: https://proj-a1.example.localhost:5601
Admin: https://proj-a1.example.localhost:5602
Ports file: /Users/x/Documents/work/runn/.runn/project.env
$ docker compose ps --all
NAME                          IMAGE       STATUS
runn_proj-a1-app-1        img         Up 12 hours (healthy)
runn_proj-a1-postgres-1   img    Up 14 hours (healthy)`;

  it("reads the app URL and detects a healthy app container", () => {
    const r = parseRunnStatus(running);
    expect(r.url).toBe("https://proj-a1.example.localhost:5601");
    expect(r.running).toBe(true);
  });

  it("reports not-running when the app container is exited", () => {
    const stopped = running.replace("Up 12 hours (healthy)", "Exited (0) 2 hours ago");
    const r = parseRunnStatus(stopped);
    expect(r.running).toBe(false);
    // still surfaces the URL so we can offer to open once it's up
    expect(r.url).toBe("https://proj-a1.example.localhost:5601");
  });

  it("only the postgres/redis containers up is not 'running'", () => {
    const noApp = `App: https://x.localhost:5601
runn_x-postgres-1   img   Up 14 hours (healthy)
runn_x-redis-1      redis      Up 14 hours`;
    expect(parseRunnStatus(noApp).running).toBe(false);
  });
});

describe("literalIncludes", () => {
  it("keeps plain paths and drops globs, comments, and negations", () => {
    const text = [
      "# Local environment",
      ".env",
      ".env.local",
      "",
      "services/*/dist/",
      "app/javascript/src/**/__generated__/",
      "services/db/generated/",
      "!keep.me",
      "../escape",
    ].join("\n");
    expect(literalIncludes(text)).toEqual([".env", ".env.local", "services/db/generated"]);
  });
});

describe("parseRunnStatus containersUp", () => {
  const out = [
    "App: https://x.example.localhost:5601",
    "NAME                         IMAGE   COMMAND   SERVICE   CREATED   STATUS",
    "runn_x-api-1                 img     \"x\"       api       3 days    Up 3 days (healthy)",
    "runn_x-app-1                 img     \"x\"       app       3 days    Exited (1) 2 hours ago",
    "runn_x-db-init-1             img     \"x\"       db-init   3 days    Exited (0) 3 days ago",
    "runn_x-postgres-1            img     \"x\"       postgres  3 days    Up 3 days (healthy)",
  ].join("\n");

  it("counts containers still up even when the app has exited", () => {
    const s = parseRunnStatus(out);
    expect(s.running).toBe(false);
    expect(s.containersUp).toBe(2);
  });

  it("is 0 for a stack that isn't up", () => {
    expect(parseRunnStatus("App: https://x\nNAME IMAGE\n").containersUp).toBe(0);
  });
});

describe("runnPortProblem", () => {
  const ps = [
    "runn_a\trunn_a-edge-1\t80/tcp, 127.0.0.1:4100-4101->4100-4101/tcp, 127.0.0.1:5600->5600/tcp",
    "runn_b\trunn_b-app-1\t",
    "runn_c\trunn_c-edge-1\t80/tcp, 443/tcp, 2019/tcp",
  ].join("\n");
  const containers = parseDockerPs(ps);

  it("flags another stack serving this checkout's port, and an edge with no ports", () => {
    expect(containers[0].ports).toEqual([4100, 4101, 5600]);
    expect(runnPortProblem("runn_a", 5600, containers)).toBeNull();
    expect(runnPortProblem("runn_b", 5600, containers)).toContain("another stack (runn_a)");
    expect(runnPortProblem("runn_c", 5601, containers)).toContain("publishes no ports");
    expect(runnPortProblem("runn_a", 5101, containers)).toContain("names port 5101");
  });
});
