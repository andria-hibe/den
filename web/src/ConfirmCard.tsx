import { useEffect, useRef } from "react";

/** Where a confirm card opens: under its button, right edges aligned. */
export type CardAnchor = { top: number; right: number };

export const anchorBelow = (el: HTMLElement): CardAnchor => {
  const r = el.getBoundingClientRect();
  return { top: r.bottom + 6, right: window.innerWidth - r.right };
};

/** A header button's "are you sure?", in a card under the button rather than
 * inline: the header's buttons don't shrink, so inline text pushed the
 * confirm and cancel buttons off a narrow window. */
export function ConfirmCard({
  at,
  message,
  confirmLabel,
  busyLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  at: CardAnchor;
  message: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (busy) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !card.current?.contains(e.target as Node)) onCancel();
    };
    // It's placed once from the button's position, which a resize moves.
    const cancel = () => onCancel();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", cancel);
    };
  }, [busy, onCancel]);

  return (
    <div className="confirm-card" ref={card} role="dialog" style={{ top: at.top, right: at.right }}>
      <div>{message}</div>
      <div className="confirm-card-actions">
        <button className="btn own-pr-btn" disabled={busy} onClick={onCancel}>
          cancel
        </button>
        <button className="btn btn-primary own-pr-btn" disabled={busy} onClick={onConfirm} autoFocus>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
