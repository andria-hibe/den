import { useEffect, useRef } from "react";
import { Terminal, type IBufferLine, type ILink } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage, ServerMessage } from "../../server/ws-protocol.ts";

/** Absolute or ~ paths, as Claude prints them (#41); the lookbehind keeps a
 * URL's own path from matching. */
const PATH_RE = /(?<=^|[\s'"`(])(?:~|\/(?:Users|private\/tmp|tmp))\/[^\s'"`<>()[\]{}|,;]+/g;

/** Links open on Cmd/Ctrl+click, like Terminal and iTerm, so a plain click
 * still selects text. */
const modClick = (e: MouseEvent) => e.metaKey || e.ctrlKey;

function lineText(line: IBufferLine | undefined): string {
  return line ? line.translateToString(true) : "";
}

/**
 * Mounts an xterm.js terminal into `hostRef` and attaches it to a server-owned
 * session over a WebSocket. The server replays scrollback on attach, so
 * switching between sessions (remount with a new id) restores history.
 *
 * The socket reconnects when it drops, and is checked with a ping whenever
 * the window comes back (#42): after the screen slept, input went nowhere
 * until the session was switched away and back.
 */
export function useTerminal(
  hostRef: React.RefObject<HTMLDivElement | null>,
  sessionId: string,
  onExit?: () => void,
  onTitle?: (name: string) => void,
) {
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const openUrl = (uri: string) => {
      if (/^https?:\/\//i.test(uri)) window.open(uri, "_blank");
    };
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
      // OSC 8 hyperlinks, which Claude Code prints for some links.
      linkHandler: { activate: (e, uri) => modClick(e) && openUrl(uri) },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((e, uri) => modClick(e) && openUrl(uri)));
    const paths = term.registerLinkProvider({
      provideLinks(y, callback) {
        const text = lineText(term.buffer.active.getLine(y - 1));
        const links: ILink[] = [];
        for (const m of text.matchAll(PATH_RE)) {
          const path = m[0].replace(/[.:]+$/, "");
          const x = (m.index ?? 0) + 1;
          links.push({
            text: path,
            range: { start: { x, y }, end: { x: x + path.length - 1, y } },
            activate: (e) => {
              if (!modClick(e)) return;
              void fetch("/api/open-path", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ path }),
              });
            },
          });
        }
        callback(links.length ? links : undefined);
      },
    });
    term.open(host);
    fit.fit();

    let ws: WebSocket | null = null;
    let disposed = false;
    let exited = false;
    let attached = false;
    let retryMs = 500;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pongTimer: ReturnType<typeof setTimeout> | undefined;

    const send = (msg: ClientMessage) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    const connect = () => {
      clearTimeout(retryTimer);
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const sock = new WebSocket(
        `${proto}://${location.host}/ws/terminal?id=${encodeURIComponent(sessionId)}`,
      );
      ws = sock;
      sock.onopen = () => {
        retryMs = 500;
        // The server replays the scrollback on every attach.
        if (attached) term.reset();
        attached = true;
        fit.fit();
        send({ type: "resize", cols: term.cols, rows: term.rows });
      };
      sock.onmessage = (ev) => {
        const msg: ServerMessage = JSON.parse(ev.data);
        if (msg.type === "output") term.write(msg.data);
        else if (msg.type === "pong") clearTimeout(pongTimer);
        else if (msg.type === "exit") {
          exited = true;
          onExitRef.current?.();
        } else if (msg.type === "title") onTitleRef.current?.(msg.name);
      };
      sock.onclose = () => {
        if (ws !== sock || disposed || exited) return;
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 5000);
      };
    };

    const reconnect = () => {
      const old = ws;
      ws = null;
      old?.close();
      connect();
    };

    // A socket can look open and still be dead after a sleep: ask, and start
    // over if there's no answer.
    const check = () => {
      if (disposed || exited || document.visibilityState !== "visible") return;
      if (ws?.readyState !== WebSocket.OPEN) {
        if (ws?.readyState !== WebSocket.CONNECTING) reconnect();
        return;
      }
      clearTimeout(pongTimer);
      pongTimer = setTimeout(reconnect, 2000);
      send({ type: "ping" });
    };

    connect();

    const disposer = term.onData((data) => send({ type: "input", data }));

    const onResize = () => {
      fit.fit();
      send({ type: "resize", cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(pongTimer);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      disposer.dispose();
      paths.dispose();
      ws?.close();
      term.dispose();
    };
  }, [sessionId]);
}
