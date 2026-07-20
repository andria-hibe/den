import { describe, it, expect } from "vitest";
import { parseRunnStatus, extractPort } from "./apprun.ts";

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
  const running = `Project: runn-a48821.runn.localhost
Branch: andria/fast-6133
App: https://runn-a48821.runn.localhost:5103
Hasura: https://runn-a48821.runn.localhost:8182
Ports file: /Users/x/Documents/work/runn/.runn/project.env
$ docker compose ps --all
NAME                          IMAGE       STATUS
runn_runn-a48821-app-1        img         Up 12 hours (healthy)
runn_runn-a48821-postgres-1   pgvector    Up 14 hours (healthy)`;

  it("reads the app URL and detects a healthy app container", () => {
    const r = parseRunnStatus(running);
    expect(r.url).toBe("https://runn-a48821.runn.localhost:5103");
    expect(r.running).toBe(true);
  });

  it("reports not-running when the app container is exited", () => {
    const stopped = running.replace("Up 12 hours (healthy)", "Exited (0) 2 hours ago");
    const r = parseRunnStatus(stopped);
    expect(r.running).toBe(false);
    // still surfaces the URL so we can offer to open once it's up
    expect(r.url).toBe("https://runn-a48821.runn.localhost:5103");
  });

  it("only the postgres/redis containers up is not 'running'", () => {
    const noApp = `App: https://x.localhost:5103
runn_x-postgres-1   pgvector   Up 14 hours (healthy)
runn_x-redis-1      redis      Up 14 hours`;
    expect(parseRunnStatus(noApp).running).toBe(false);
  });
});
