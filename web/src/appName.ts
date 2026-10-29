import { useSyncExternalStore } from "react";

// The app's own name in its copy: "den", or "burrow" in Burrow. App sets it
// once it knows the edition (GET /api/edition); until then it reads "den".
let name = "den";
const listeners = new Set<() => void>();

export function setAppName(next: string): void {
  name = next;
  for (const l of listeners) l();
}

export function useAppName(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => name,
  );
}
