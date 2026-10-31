import { store } from "./store.ts";

const ENDPOINT = "https://api.linear.app/graphql";
const KEY_SETTING = "linear_api_key";

// --- Types exposed to the web app -------------------------------------------

export interface LinearIssue {
  identifier: string; // e.g. "FAST-5979"
  title: string;
  url: string;
  priority: number; // 0 none, 1 urgent, 2 high, 3 medium, 4 low
  priorityLabel: string;
  branchName?: string;
  description?: string;
  state: { name: string; type: string; color: string };
  project?: string;
  updatedAt: string;
  /** Lowercased identifier, for matching PR branch hints (e.g. "fast-5979"). */
  ticketHint: string;
}

export interface LinearData {
  connected: true;
  viewer: string;
  issues: LinearIssue[];
  /** Count of the viewer's unread, unarchived Linear notifications (inbox). */
  unreadNotifications: number;
  fetchedAt: string;
}

export interface LinearComment {
  author: string;
  body: string;
  at: string;
}

// --- Key management ---------------------------------------------------------

export function getKey(): string | null {
  return store.getSetting(KEY_SETTING) ?? process.env.LINEAR_API_KEY ?? null;
}

export function hasKey(): boolean {
  return !!getKey();
}

export function setKey(key: string) {
  store.setSetting(KEY_SETTING, key.trim());
}

export function clearKey() {
  store.deleteSetting(KEY_SETTING);
}

// --- GraphQL ----------------------------------------------------------------

async function graphql<T>(
  query: string,
  key: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  // fetch has no timeout by default, so a hung Linear API would leave the route
  // pending forever.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: key, // Linear personal keys: raw key, no "Bearer" prefix
      },
      body: JSON.stringify({ query, variables }),
      signal: ac.signal,
    });
  } catch (err) {
    if (ac.signal.aborted) throw new Error("linear_timeout", { cause: err });
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new Error("unauthorized");
  if (!res.ok) throw new Error(`linear_http_${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error("no_data");
  return json.data;
}

/** Validate a key by fetching the viewer; returns the viewer's name. */
export async function validateKey(key: string): Promise<string> {
  const data = await graphql<{ viewer: { name: string } }>(
    `query { viewer { name } }`,
    key,
  );
  return data.viewer.name;
}

const PRIORITY_LABELS = ["none", "urgent", "high", "medium", "low"];
// Order active states sensibly: started work first, then unstarted, then backlog.
const STATE_ORDER: Record<string, number> = {
  started: 0,
  unstarted: 1,
  backlog: 2,
  triage: 3,
};

interface RawIssue {
  identifier: string;
  title: string;
  url: string;
  priority: number;
  branchName?: string | null;
  description?: string | null;
  updatedAt: string;
  state: { name: string; type: string; color: string };
  project?: { name: string } | null;
}

export async function getAssignedIssues(): Promise<LinearData> {
  const key = getKey();
  if (!key) throw new Error("not_connected");

  const data = await graphql<{
    viewer: { name: string; assignedIssues: { nodes: RawIssue[] } };
    inboxNotifications: { nodes: InboxState[] };
  }>(
    `query {
      viewer {
        name
        assignedIssues(first: 100) {
          nodes {
            identifier
            title
            url
            priority
            branchName
            description
            updatedAt
            state { name type color }
            project { name }
          }
        }
      }
      inboxNotifications(first: 100, unreadOnly: true) {
        nodes { readAt archivedAt snoozedUntilAt }
      }
    }`,
    key,
  );

  const issues: LinearIssue[] = data.viewer.assignedIssues.nodes
    // Only active work — drop done/cancelled.
    .filter((n) => n.state.type !== "completed" && n.state.type !== "canceled")
    .map((n) => ({
      identifier: n.identifier,
      title: n.title,
      url: n.url,
      priority: n.priority,
      priorityLabel: PRIORITY_LABELS[n.priority] ?? "none",
      branchName: n.branchName ?? undefined,
      description: n.description ?? undefined,
      state: n.state,
      project: n.project?.name,
      updatedAt: n.updatedAt,
      ticketHint: n.identifier.toLowerCase(),
    }))
    .sort((a, b) => {
      const so = (STATE_ORDER[a.state.type] ?? 9) - (STATE_ORDER[b.state.type] ?? 9);
      if (so !== 0) return so;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const unreadNotifications = (data.inboxNotifications?.nodes ?? []).filter(showsUnread).length;

  return {
    connected: true,
    viewer: data.viewer.name,
    issues,
    unreadNotifications,
    fetchedAt: new Date().toISOString(),
  };
}

interface RawComment {
  body: string;
  createdAt: string;
  user?: { name?: string; displayName?: string } | null;
  // Integrations / Linear's own agents post as a botActor, not a user.
  botActor?: { name?: string } | null;
}

/** Comments on a single issue (by identifier, e.g. "FAST-6115"), oldest first. */
/** A ticket's sub-issues, for finding work already done under them. */
export async function getSubIssues(
  identifier: string,
): Promise<{ identifier: string; branchName: string }[]> {
  const key = getKey();
  const m = identifier.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!key || !m) return [];
  const data = await graphql<{
    issues: { nodes: { children: { nodes: { identifier: string; branchName: string }[] } }[] };
  }>(
    `query subIssues($number: Float!, $teamKey: String!) {
      issues(filter: { number: { eq: $number }, team: { key: { eq: $teamKey } } }, first: 1) {
        nodes { children(first: 50) { nodes { identifier branchName } } }
      }
    }`,
    key,
    { number: Number(m[2]), teamKey: m[1].toUpperCase() },
  );
  return data.issues.nodes[0]?.children.nodes ?? [];
}

export async function getIssueComments(
  identifier: string,
): Promise<LinearComment[]> {
  const key = getKey();
  if (!key) throw new Error("not_connected");
  const m = identifier.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!m) return [];
  const teamKey = m[1].toUpperCase();
  const number = Number(m[2]);

  const data = await graphql<{
    issues: { nodes: { comments: { nodes: RawComment[] } }[] };
  }>(
    `query issueComments($number: Float!, $teamKey: String!) {
      issues(filter: { number: { eq: $number }, team: { key: { eq: $teamKey } } }, first: 1) {
        nodes {
          comments(first: 100) {
            nodes { body createdAt user { name displayName } botActor { name } }
          }
        }
      }
    }`,
    key,
    { number, teamKey },
  );

  const node = data.issues.nodes[0];
  if (!node) return [];
  return node.comments.nodes
    .filter((c) => c.body?.trim())
    .map((c) => ({
      author:
        c.user?.displayName ?? c.user?.name ?? c.botActor?.name ?? "someone",
      body: c.body,
      at: c.createdAt,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

interface InboxState {
  readAt: string | null;
  archivedAt: string | null;
  snoozedUntilAt?: string | null;
}

/** Unread in the inbox as Linear shows it: read, archived, and snoozed
 * notifications don't count. */
const showsUnread = (n: InboxState) =>
  !n.readAt && !n.archivedAt && !(n.snoozedUntilAt && Date.parse(n.snoozedUntilAt) > Date.now());

/** An unread item in the developer's Linear inbox. */
export interface LinearNotification {
  /** Linear's notification type, e.g. issueCommentMention, issueAssignedToYou. */
  type: string;
  actor: string | null;
  issue: { identifier: string; title: string; url: string } | null;
  /** Linear's own title and link for it, which a pull request notification
   * has where an issue one has `issue`. */
  title: string | null;
  url: string | null;
  /** The comment it's about, trimmed, when there is one. */
  comment: string | null;
  createdAt: string;
}

/** The unread notifications in the Linear inbox, grouped as the inbox
 * groups them, for the Manager's digest. A separate query from getAssignedIssues, so a schema
 * surprise here can't take the ticket list down with it. */
export async function getInboxNotifications(): Promise<LinearNotification[]> {
  const key = getKey();
  if (!key) throw new Error("not_connected");
  const data = await graphql<{
    inboxNotifications: {
      nodes: (InboxState & {
        type: string;
        title: string | null;
        url: string | null;
        createdAt: string;
        actor: { name: string } | null;
        issue?: { identifier: string; title: string; url: string } | null;
        comment?: { body: string } | null;
      })[];
    };
  }>(
    `query {
      inboxNotifications(first: 50, unreadOnly: true) {
        nodes {
          type readAt archivedAt snoozedUntilAt createdAt title url
          actor { name }
          ... on IssueNotification { issue { identifier title url } comment { body } }
        }
      }
    }`,
    key,
  );
  return data.inboxNotifications.nodes
    .filter(showsUnread)
    .map((n) => ({
      type: n.type,
      actor: n.actor?.name ?? null,
      issue: n.issue ?? null,
      title: n.title ?? null,
      url: n.url ?? null,
      comment: n.comment?.body ? n.comment.body.replace(/\s+/g, " ").slice(0, 300) : null,
      createdAt: n.createdAt,
    }));
}
