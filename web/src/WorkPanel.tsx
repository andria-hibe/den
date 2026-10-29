import type { PullRequest } from "../../server/github.ts";
import { LinearSection } from "./LinearPanel.tsx";
import { Fox } from "./Fox.tsx";
import { accentStyle, relTime } from "./format.ts";
import { useWorkData } from "./WorkData.tsx";
import { usePersistentString } from "./usePersistent.ts";

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

function PrCard({
  pr,
  onOpen,
  onDismiss,
  accent,
}: {
  pr: PullRequest;
  onOpen: (pr: PullRequest) => void;
  onDismiss: (pr: PullRequest) => void;
  accent?: string;
}) {
  const check = CHECK_ICON[pr.checks];
  const review = REVIEW_LABEL[pr.review];
  // Your own approved PR with no red/pending CI is genuinely ready to merge —
  // surface that as its own badge instead of the generic "approved" one.
  const readyToMerge =
    pr.isMine &&
    pr.review === "approved" &&
    !pr.isDraft &&
    pr.checks !== "failing" &&
    pr.checks !== "pending" &&
    pr.mergeable !== "CONFLICTING";
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
          <button
            type="button"
            className="pr-attn"
            title={`${pr.attentionReason ?? "needs your attention"} — click to dismiss`}
            aria-label={`dismiss: ${pr.attentionReason ?? "needs your attention"}`}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(pr);
            }}
          >
            <span className="pr-attn-bang">!</span>
            <span className="pr-attn-x">×</span>
          </button>
        )}
        <span className={`pr-check ${check.cls}`} title={`checks ${pr.checks}`}>
          {check.icon}
        </span>
        <span className="pr-repo">
          {pr.repo.split("/")[1] ?? pr.repo} #{pr.number}
        </span>
        {pr.isDraft && <span className="pr-badge draft">draft</span>}
        {pr.mergeable === "CONFLICTING" && (
          <span
            className="pr-badge conflicts"
            title={`conflicts with ${pr.baseBranch ?? "its base"}, so CI won't start`}
          >
            conflicts
          </span>
        )}
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
        {/* You reviewed it, so it no longer nags — but it stays listed until it's
            merged or closed, and the badge says why it's still here. */}
        {pr.reviewedByMe && !pr.reviewRequestedFromMe && (
          <span className="pr-badge reviewed" title="you have reviewed this PR">
            ✓ reviewed
          </span>
        )}
        {readyToMerge ? (
          <span className="pr-badge ready" title="approved & checks green — ready to merge">
            ✓ ready to merge
          </span>
        ) : (
          review && <span className={`pr-badge review-${pr.review}`}>{review}</span>
        )}
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

function PrList({
  prs,
  onOpenPr,
  onDismissPr,
  prColor,
}: {
  prs: PullRequest[];
  onOpenPr: (pr: PullRequest) => void;
  onDismissPr: (pr: PullRequest) => void;
  prColor?: (repo: string, number: number, hint?: string) => string | undefined;
}) {
  if (prs.length === 0) {
    return (
      <div className="placeholder" style={{ padding: "4px 6px" }}>
        nothing here 🌿
      </div>
    );
  }
  return (
    <>
      {prs.map((pr) => (
        <PrCard
          key={`${pr.repo}#${pr.number}`}
          pr={pr}
          onOpen={onOpenPr}
          onDismiss={onDismissPr}
          accent={prColor?.(pr.repo, pr.number, pr.ticketHint)}
        />
      ))}
    </>
  );
}

/** A tab label with its count, and a "!" when anything in it needs you. */
function tabLabel(name: string, prs: PullRequest[]): string {
  const bang = prs.some((p) => p.needsAttention) ? " !" : "";
  return `${name}${prs.length ? ` (${prs.length})` : ""}${bang}`;
}

export function WorkPanel({
  onOpenTicket,
  onOpenPr,
  ticketColor,
  prColor,
  onFold,
  foldTitle,
}: {
  /** Fold the panel to its strip; the button sits at the head's right edge. */
  onFold?: () => void;
  foldTitle?: string;
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
    dismissPrAttention,
    linear,
  } = useWorkData();

  // Linear and GitHub each get the whole column on a small screen, rather
  // than GitHub sitting below every ticket.
  const [source, setSource] = usePersistentString("den.workTab", "linear", ["linear", "github"] as const);
  const [prTab, setPrTab] = usePersistentString("den.prTab", "review", ["review", "mine"] as const);
  const linearBang = (linear?.unreadNotifications ?? 0) > 0 ? " !" : "";
  const prsBang = data && [...data.reviewRequested, ...data.authored].some((p) => p.needsAttention) ? " !" : "";

  return (
    <aside className="panel work">
      <div className="work-head">
        <h2 style={{ margin: 0 }}>work</h2>
        {onFold && (
          <button className="work-fold" onClick={onFold} title={foldTitle} aria-label="fold the work panel">
            »
          </button>
        )}
      </div>
      <div className="ticket-look-tabs work-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={source === "linear"}
          className={`look-tab${source === "linear" ? " active" : ""}`}
          onClick={() => setSource("linear")}
        >
          Linear{linearBang}
        </button>
        <button
          role="tab"
          aria-selected={source === "github"}
          className={`look-tab${source === "github" ? " active" : ""}`}
          onClick={() => setSource("github")}
        >
          GitHub{prsBang}
        </button>
      </div>

      <div className="pr-scroll">
        {source === "linear" ? (
          <LinearSection onOpenTicket={onOpenTicket} ticketColor={ticketColor} />
        ) : (
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
                <div className="ticket-look-tabs pr-tabs" role="tablist">
                  <button
                    role="tab"
                    aria-selected={prTab === "review"}
                    className={`look-tab${prTab === "review" ? " active" : ""}`}
                    onClick={() => setPrTab("review")}
                  >
                    {tabLabel("Review requested", data.reviewRequested)}
                  </button>
                  <button
                    role="tab"
                    aria-selected={prTab === "mine"}
                    className={`look-tab${prTab === "mine" ? " active" : ""}`}
                    onClick={() => setPrTab("mine")}
                  >
                    {tabLabel("My open PRs", data.authored)}
                  </button>
                </div>
                <PrList
                  prs={prTab === "review" ? data.reviewRequested : data.authored}
                  onOpenPr={onOpenPr}
                  onDismissPr={dismissPrAttention}
                  prColor={prColor}
                />
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
