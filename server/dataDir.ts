// Where den keeps its database, notepads, review files, inbox, limits, and
// manager files. A test server sets DEN_DATA_DIR: DEN_DB alone still shares
// the notepads and manager files with the installed app.
import { homedir } from "node:os";
import { join } from "node:path";

export const DATA_DIR = process.env.DEN_DATA_DIR ?? join(homedir(), ".den");
