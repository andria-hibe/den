import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage, ServerMessage } from "../../server/ws-protocol.ts";

/**
 * Mounts an xterm.js terminal into `hostRef` and attaches it to a server-owned
 * session over a WebSocket. The server replays scrollback on attach, so
 * switching between sessions (remount with a new id) restores history.
 */
export function useTerminal(
  hostRef: React.RefObject<HTMLDivElement | null>,
  sessionId: string,
  onExit?: () => void,
) {
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily:
        'ui-monospace, "SF Mono", Menlo, Consolas, "Cascadia Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#2b2233",
        foreground: "#f3e9f7",
        cursor: "#ffb7d5",
        selectionBackground: "#5b4b66",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/ws/terminal?id=${encodeURIComponent(sessionId)}`,
    );

    const send = (msg: ClientMessage) =>
      ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

    ws.onopen = () => {
      fit.fit();
      send({ type: "resize", cols: term.cols, rows: term.rows });
    };
    ws.onmessage = (ev) => {
      const msg: ServerMessage = JSON.parse(ev.data);
      if (msg.type === "output") term.write(msg.data);
      else if (msg.type === "exit") onExitRef.current?.();
    };

    const disposer = term.onData((data) => send({ type: "input", data }));

    const onResize = () => {
      fit.fit();
      send({ type: "resize", cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    window.addEventListener("resize", onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      disposer.dispose();
      ws.close();
      term.dispose();
    };
  }, [sessionId]);
}
