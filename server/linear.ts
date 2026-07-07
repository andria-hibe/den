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

async function graphql<T>(query: string, key: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: key, // Linear personal keys: raw key, no "Bearer" prefix
    },
    body: JSON.stringify({ query }),
  });
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
    notifications: { nodes: { readAt: string | null; archivedAt: string | null }[] };
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
      notifications(first: 100) {
        nodes { readAt archivedAt }
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

  const unreadNotifications = (data.notifications?.nodes ?? []).filter(
    (n) => !n.readAt && !n.archivedAt,
  ).length;

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
    `query {
      issues(filter: { number: { eq: ${number} }, team: { key: { eq: "${teamKey}" } } }, first: 1) {
        nodes {
          comments(first: 100) {
            nodes { body createdAt user { name displayName } botActor { name } }
          }
        }
      }
    }`,
    key,
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
