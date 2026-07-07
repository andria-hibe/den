import { type CSSProperties } from "react";
import type { PullRequest } from "../../server/github.ts";
import { LinearSection } from "./LinearPanel.tsx";
import { Fox } from "./Fox.tsx";
import { useWorkData } from "./WorkData.tsx";

const CHECK_ICON: Record<PullRequest["checks"], { icon: string; cls: string }> = {
  passing: { icon: "✓", cls: "check-pass" },
  failing: { icon: "✕", cls: "check-fail" },
  pending: { icon: "◐", cls: "check-pending" },
  none: { icon: "·", cls: "check-none" },
};

const REVIEW_LABEL: Record<PullRequest["review"], string | null> = {
  approved: "approved",
  changes_requested: "changes",
  review_required: "needs review",
  none: null,
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// A card linked to an open session is tinted with that session's colour (left
// stripe + faint wash) so related work reads at a glance.
function accentStyle(color?: string): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    borderLeftColor: color,
    borderLeftWidth: 5,
    background: `color-mix(in srgb, ${color} 16%, var(--bg-rail))`,
  };
}

function PrCard({
  pr,
  onOpen,
  accent,
}: {
  pr: PullRequest;
  onOpen: (pr: PullRequest) => void;
  accent?: string;
}) {
  const check = CHECK_ICON[pr.checks];
  const review = REVIEW_LABEL[pr.review];
  return (
    <div
      className={`pr-card ticket-card${pr.needsAttention ? " needs-attention" : ""}${accent ? " session-linked" : ""}`}
      style={accentStyle(accent)}
      onClick={() => onOpen(pr)}
      role="button"
      tabIndex={0}
    >
      <div className="pr-top">
        {pr.needsAttention && (
          <span
            className="pr-attn"
            title={pr.attentionReason ?? "needs your attention"}
          >
            !
          </span>
        )}
        <span className={`pr-check ${check.cls}`} title={`checks ${pr.checks}`}>
          {check.icon}
        </span>
        <span className="pr-repo">
          {pr.repo.split("/")[1] ?? pr.repo} #{pr.number}
        </span>
        {pr.isDraft && <span className="pr-badge draft">draft</span>}
        <a
          className="ticket-ext"
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          title="open on GitHub"
          onClick={(e) => e.stopPropagation()}
        >
          ↗
        </a>
        <span className="pr-time">{relTime(pr.updatedAt)}</span>
      </div>
      <div className="pr-title">{pr.title}</div>
      <div className="pr-meta">
        {pr.ticketHint && <span className="pr-badge ticket">{pr.ticketHint}</span>}
        {review && <span className={`pr-badge review-${pr.review}`}>{review}</span>}
        {pr.checkCounts.total > 0 && (
          <span className="pr-checkcounts">
            {pr.checkCounts.failed > 0 && `${pr.checkCounts.failed}✕ `}
            {pr.checkCounts.pending > 0 && `${pr.checkCounts.pending}◐ `}
            {pr.checkCounts.passed}✓
          </span>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  prs,
  onOpenPr,
  prColor,
}: {
  title: string;
  prs: PullRequest[];
  onOpenPr: (pr: PullRequest) => void;
  prColor?: (repo: string, number: number, hint?: string) => string | undefined;
}) {
  return (
    <div className="pr-section">
      <div className="pr-section-title">
        {title} <span className="pr-count">{prs.length}</span>
      </div>
      {prs.length === 0 ? (
        <div className="placeholder" style={{ padding: "4px 6px" }}>
          nothing here 🌿
        </div>
      ) : (
        prs.map((pr) => (
          <PrCard
            key={`${pr.repo}#${pr.number}`}
            pr={pr}
            onOpen={onOpenPr}
            accent={prColor?.(pr.repo, pr.number, pr.ticketHint)}
          />
        ))
      )}
    </div>
  );
}

export function WorkPanel({
  onOpenTicket,
  onOpenPr,
  ticketColor,
  prColor,
}: {
  onOpenTicket: (issue: import("../../server/linear.ts").LinearIssue) => void;
  onOpenPr: (pr: PullRequest) => void;
  ticketColor?: (identifier: string, hint?: string) => string | undefined;
  prColor?: (repo: string, number: number, hint?: string) => string | undefined;
}) {
  const {
    prs: data,
    prsError: error,
    prsLoading: loading,
    refreshPrs,
  } = useWorkData();

  return (
    <aside className="panel work">
      <div className="work-head">
        <h2 style={{ margin: 0 }}>work</h2>
      </div>

      <div className="pr-scroll">
        <LinearSection onOpenTicket={onOpenTicket} ticketColor={ticketColor} />

        <div className="pr-section">
          <div className="pr-section-title">
            <span>github</span>
            {data && (
              <span className="pr-count">
                {data.reviewRequested.length + data.authored.length}
              </span>
            )}
            <span style={{ marginLeft: "auto" }}>
              <button
                className="btn-ghost"
                onClick={refreshPrs}
                disabled={loading}
                title="refresh"
              >
                {loading ? "…" : "↻"}
              </button>
            </span>
          </div>
          {error && <div className="browser-error">⚠️ {error}</div>}
          {!data && !error && (
            <div className="loading-row">
              <Fox pose="walk" size={22} /> loading your PRs…
            </div>
          )}
          {data && (
            <>
              <Section
                title="review requested"
                prs={data.reviewRequested}
                onOpenPr={onOpenPr}
                prColor={prColor}
              />
              <Section
                title="my open PRs"
                prs={data.authored}
                onOpenPr={onOpenPr}
                prColor={prColor}
              />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
