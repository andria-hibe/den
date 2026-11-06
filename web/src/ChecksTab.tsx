import { useEffect, useMemo, useState } from "react";
import { api } from "./api.ts";
import { relTimeAgo } from "./format.ts";
import { Critter } from "./Critter.tsx";
import { CRITTERS, type CritterKind } from "./critterSprites.ts";
import { CrewRunDetails } from "./CrewRuns.tsx";
import { CheckResultsDialog, type CheckResult } from "./CheckResults.tsx";
import { usePersistentString } from "./usePersistent.ts";
import type { CrewRun } from "../../server/crewActivity.ts";
import type { CheckRow } from "../../server/store.ts";

type CheckItem = Omit<CheckRow, "body">;

/** The kinds a filter covers; "other" is the rest of the crew. */
const FILTERS = [
  { key: "all", label: "All", kinds: null },
  { key: "security", label: "Security", kinds: ["wolf"] },
  { key: "performance", label: "Performance", kinds: ["hare"] },
  { key: "design", label: "Design", kinds: ["bowerbird"] },
  { key: "testing", label: "Testing", kinds: ["badger"] },
  { key: "review", label: "Code review", kinds: ["owl"] },
  { key: "ready", label: "Ready checks", kinds: ["ready check"] },
  { key: "deep", label: "Deep reviews", kinds: ["deep review"] },
  { key: "other", label: "Other", kinds: ["raccoon", "tanuki", "squirrel"] },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const isCritter = (k: string): k is CritterKind => k in CRITTERS;

/** Every helper run and check result den has logged, newest first, to look
 * back at what was checked on which PR. */
export function ChecksTab() {
  const [checks, setChecks] = useState<CheckItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = usePersistentString<FilterKey>("den.checksFilter", "all", FILTERS.map((f) => f.key));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api<{ checks: CheckItem[] }>("/api/checks")
        .then((d) => !stop && (setChecks(d.checks), setError(null)))
        .catch((e) => !stop && setError((e as Error).message));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const shown = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds;
    const q = query.trim().toLowerCase();
    return (checks ?? []).filter(
      (c) =>
        (!kinds || (kinds as readonly string[]).includes(c.kind)) &&
        (!q || [c.session, c.ticket, c.pr, c.branch, c.summary, c.kind].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [checks, filter, query]);

  return (
    <div className="pr-section checks-tab">
      <div className="checks-filters" role="group" aria-label="filter checks">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`checks-filter${filter === f.key ? " on" : ""}`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <input
        className="checks-search"
        placeholder="search by PR, ticket, session, or finding"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <div className="browser-error">⚠️ {error}</div>}
      {checks && !shown.length && (
        <div className="placeholder" style={{ padding: "4px 6px" }}>
          {checks.length ? "nothing matches" : "no checks logged yet: they appear here as helpers finish"}
        </div>
      )}
      {shown.map((c) => (
        <CheckEntry key={c.id} item={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
      ))}
    </div>
  );
}

function CheckEntry({ item, open, onToggle }: { item: CheckItem; open: boolean; onToggle: () => void }) {
  const [body, setBody] = useState<CrewRun | CheckResult | null>(null);
  const [dialog, setDialog] = useState(false);
  const workflow = item.kind === "ready check" || item.kind === "deep review";
  useEffect(() => {
    if (!open || body) return;
    api<{ body: CrewRun | CheckResult }>(`/api/checks/${encodeURIComponent(item.id)}`)
      .then((d) => setBody(d.body))
      .catch(() => {});
  }, [open, body, item.id]);
  const where = [item.ticket, item.pr ?? item.branch].filter(Boolean).join(" · ");
  return (
    <div className={`checks-entry${open ? " open" : ""}`}>
      <button className="checks-entry-head" onClick={onToggle} aria-expanded={open}>
        {isCritter(item.kind) ? (
          <Critter kind={item.kind} bust size={22} />
        ) : (
          <span className="checks-kind-icon" aria-hidden>
            ✓
          </span>
        )}
        <span className="checks-entry-text">
          <span className="checks-entry-top">
            <span className="src-chip">{item.kind}</span>
            <span className="checks-entry-session">{item.session}</span>
            <span className="checks-entry-when">{relTimeAgo(item.at)}</span>
          </span>
          <span className="checks-entry-summary">{item.summary}</span>
          {where && <span className="checks-entry-where">{where}</span>}
        </span>
      </button>
      {open &&
        (!body ? (
          <div className="loading-row">loading...</div>
        ) : workflow ? (
          <button className="btn btn-ghost-outline checks-open" onClick={() => setDialog(true)}>
            open the findings
          </button>
        ) : (
          <CrewRunDetails run={body as CrewRun} />
        ))}
      {dialog && body && <CheckResultsDialog result={body as CheckResult} at={item.at} onClose={() => setDialog(false)} />}
    </div>
  );
}
