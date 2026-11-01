// A command den types into a shell tab (set up, run) ends with a marker line
// carrying its exit status, so den can tell the workspace's Claude pane how
// it went (#37).

export type TabRunLabel = "set up" | "run";

/** Shell to append after the command. The tab echoes this line as typed,
 * with `%s` where the status goes, so only the printed marker has a number. */
export function finishMarker(label: TabRunLabel): string {
  return `; printf '\\n[den] ${label} finished with exit %s\\n' $?`;
}

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/** Terminal output as plain lines: escape sequences gone, and a line redrawn
 * with `\r` reduced to what it showed last. */
export function plainLines(output: string): string[] {
  return output
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.split("\r").filter(Boolean).pop() ?? "")
    .map((l) => l.trimEnd());
}

/** The exit status from a finish marker in `output`, and the lines before it. */
export function parseFinish(
  output: string,
  label: TabRunLabel,
): { exit: number; before: string[] } | null {
  const lines = plainLines(output);
  const re = new RegExp(`^\\[den\\] ${label} finished with exit (\\d+)$`);
  const at = lines.findIndex((l) => re.test(l));
  if (at < 0) return null;
  // The shell's echo (and redraws) of the typed command carry the marker too.
  const typed = `[den] ${label} finished with exit %s`;
  const before = lines.slice(0, at).filter((l) => l.trim() && !l.includes(typed));
  return { exit: Number(lines[at].match(re)![1]), before };
}

const TAKEN_PORT = [
  /Bind for \S*:(\d+) failed: port is already allocated/,
  /Ports are not available: exposing port TCP \S*:(\d+)/,
  /EADDRINUSE: address already in use \S*:(\d+)/,
];

/** Host ports the output says were already taken (Docker's bind errors, and
 * Node's EADDRINUSE). */
export function takenPorts(lines: string[]): number[] {
  const ports = new Set<number>();
  for (const line of lines) {
    for (const re of TAKEN_PORT) {
      const m = line.match(re);
      if (m) ports.add(Number(m[1]));
    }
  }
  return [...ports];
}

export interface FinishFacts {
  /** "the app" or "the worktree set up". */
  what: string;
  command: string;
  dir: string;
  exit: number;
  /** The output's last lines. */
  tail: string[];
  /** Each port the output says was taken, and what holds it if den found out. */
  taken: { port: number; holder: string | null }[];
  /** den's check of the app afterwards (#34). */
  problem?: string | null;
  /** The checkout's own port settings file, when den knows it. */
  portsFile?: string;
}

/** What den tells the workspace's Claude pane when a set up or run in a tab
 * ends. A failure asks the pane to fix it there and then, since otherwise it
 * reported the error and waited for the developer to say "fix it". */
export function finishReport(f: FinishFacts): string {
  const out = [`${f.what} finished with exit ${f.exit}. Its last lines:`, ...f.tail];
  for (const t of f.taken) {
    out.push(`Port ${t.port} was already taken${t.holder ? `, by ${t.holder}` : ""}.`);
  }
  if (f.problem) out.push(`den's check of the app afterwards: ${f.problem}`);
  // 130 and 143 are Ctrl-C and a kill: the developer stopping it, not a failure.
  const failed = f.exit !== 0 && f.exit !== 130 && f.exit !== 143;
  if (!failed && !f.problem) return out.join("\n");
  const where = f.portsFile
    ? ` in ${f.portsFile} (add any port variable the compose files read, even one not listed there yet)`
    : " in its local, uncommitted settings";
  out.push(
    `Diagnose and fix this now, without waiting for the developer to ask: find the ` +
      `cause, fix it in this checkout, run the step that failed again yourself (the ` +
      `whole command was \`${f.command}\`, from ${f.dir}), and check it works. Then ` +
      `tell the developer in a line or two what was wrong and what you changed.`,
  );
  if (f.taken.length || f.problem) {
    out.push(
      `For a port that is already taken, give this checkout a free port${where}, then ` +
        `restart its stack. Check a port is free with \`lsof -nP -iTCP:<port> -sTCP:LISTEN\` ` +
        `and \`docker ps\`. Don't stop or kill what holds the port: it is usually another ` +
        `session's app.`,
    );
  }
  out.push(
    `Ask the developer first before anything that stops, removes, or changes something ` +
      `outside this checkout, or changes committed files.`,
  );
  return out.join("\n");
}
