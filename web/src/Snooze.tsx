// Snoozing a PR card: hidden from its list, the "!", and notifications until
// the snooze ends. The times live in WorkData (`den.snoozedPrs`).

const DAY = 24 * 60 * 60 * 1000;

/** Tomorrow ends at 9am, the start of a working day, not 24 hours on. */
export const SNOOZE_CHOICES: { label: string; until: (now: Date) => number }[] = [
  {
    label: "tomorrow",
    until: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    },
  },
  { label: "3 days", until: (now) => now.getTime() + 3 * DAY },
  { label: "a week", until: (now) => now.getTime() + 7 * DAY },
];

function untilLabel(until: number): string {
  return new Date(until).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** The card's "zz": opens the choices, or wakes a snoozed card. */
export function SnoozeButton({ until, picking, onClick }: { until?: number; picking: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`pr-snooze${until || picking ? " on" : ""}`}
      title={until ? `snoozed until ${untilLabel(until)}; click to wake it` : "snooze: hide this PR for a while"}
      aria-label={until ? "wake this PR" : "snooze this PR"}
      aria-pressed={!!until}
      aria-expanded={until ? undefined : picking}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      zz
    </button>
  );
}

export function SnoozePick({ onPick, onCancel }: { onPick: (until: number) => void; onCancel: () => void }) {
  return (
    <div
      className="snooze-pick"
      role="group"
      aria-label="snooze for"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onCancel();
      }}
    >
      {SNOOZE_CHOICES.map((c, i) => (
        <button
          key={c.label}
          type="button"
          className="btn btn-ghost-outline"
          autoFocus={i === 0}
          onClick={() => onPick(c.until(new Date()))}
        >
          {c.label}
        </button>
      ))}
      <button type="button" className="btn btn-ghost-outline" onClick={onCancel}>
        cancel
      </button>
    </div>
  );
}

/** The foot of a list: how many cards are snoozed, and a toggle to see them. */
export function SnoozedToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  if (count === 0) return null;
  return (
    <button type="button" className="snoozed-toggle" onClick={onToggle} aria-expanded={open}>
      zz {count} snoozed {open ? "▴" : "▾"}
    </button>
  );
}
