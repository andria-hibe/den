import { homedir } from "node:os";
import { join } from "node:path";
import type { Edition } from "../shared/edition.ts";

/** Which app this is. The packaged Burrow app has DEN_EDITION baked in by
 * esbuild's --define (pack:burrow); in dev it's an ordinary env var. */
export const EDITION: Edition = process.env.DEN_EDITION === "burrow" ? "burrow" : "den";

/** Where this app keeps its database, notepads, and other files. Burrow's is
 * separate so it never touches the sessions a running Den owns. */
export const DATA_DIR = join(homedir(), EDITION === "burrow" ? ".burrow" : ".den");

/** Both apps' data dirs, for what belongs to the account rather than the app
 * (the plan's limits). */
export const ALL_DATA_DIRS = [join(homedir(), ".den"), join(homedir(), ".burrow")];

/** The Manager pane and its Today list are Burrow's (#46). */
export const MANAGER_ENABLED = EDITION === "burrow";
