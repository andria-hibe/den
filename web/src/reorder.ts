// List-order helpers for dragging the session rail.

/** Move the item at `from` so it sits at index `to`, returning a new array. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Order a flat session list so its workspaces follow `groupIds`.
 *
 * The optimistic update after a drag; keep it in step with
 * `reorderPositions` in server/sessions.ts, which persists the order.
 * A group the order doesn't name keeps its place after the named ones, and the
 * panes within a workspace keep their relative order (the sort is stable).
 */
export function sortByGroupOrder<T extends { groupId: string }>(
  list: T[],
  groupIds: string[],
): T[] {
  const rank = new Map(groupIds.map((g, i) => [g, i]));
  return [...list].sort(
    (a, b) =>
      (rank.get(a.groupId) ?? groupIds.length) -
      (rank.get(b.groupId) ?? groupIds.length),
  );
}
