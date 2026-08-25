import { useEffect, useRef } from "react";
import type { PullRequest } from "../../server/github.ts";
import type { SessionMeta } from "../../server/sessions.ts";
import { prKey } from "./format.ts";

// Native OS notifications for the two things that need you when den isn't in
// focus: a background session ringing the bell, and a PR newly needing your
// action (CI failing / changes requested / a review you owe). We fire only on
// *transitions* — the state present at startup is seeded silently so a fresh
// launch never spams. A `null` "previous" ref means "not seeded yet".
function notify(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // some environments throw if construction isn't allowed — ignore
  }
}

export function useNotifications({
  sessions,
  activeId,
  prsReady,
  prsNeedingAttention,
}: {
  sessions: SessionMeta[];
  activeId: string | null;
  /** True once the PR list has loaded at least once (avoids seeding on empty). */
  prsReady: boolean;
  prsNeedingAttention: PullRequest[];
}) {
  // Ask once; a denied/blocked permission just makes notify() a no-op.
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Session bell — notify when a *background* session raises attention.
  const prevAttn = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (sessions.length === 0) return; // nothing loaded yet
    const now = new Set(
      sessions.filter((s) => s.attention && s.id !== activeId).map((s) => s.id),
    );
    if (prevAttn.current === null) {
      prevAttn.current = now; // seed silently
      return;
    }
    for (const s of sessions) {
      if (s.attention && s.id !== activeId && !prevAttn.current.has(s.id)) {
        notify(`🦊 ${s.name}`, "This session wants your attention.");
      }
    }
    prevAttn.current = now;
  }, [sessions, activeId]);

  // PRs — notify when one newly starts needing your action.
  const prevPr = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!prsReady) return;
    const now = new Set(prsNeedingAttention.map(prKey));
    if (prevPr.current === null) {
      prevPr.current = now; // seed silently
      return;
    }
    for (const p of prsNeedingAttention) {
      if (!prevPr.current.has(prKey(p))) {
        notify(
          `PR #${p.number} needs you`,
          `${p.title} — ${p.attentionReason ?? "needs your attention"}`,
        );
      }
    }
    prevPr.current = now;
  }, [prsReady, prsNeedingAttention]);
}
