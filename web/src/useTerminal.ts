import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage, ServerMessage } from "../../server/ws-protocol.ts";

export interface TerminalConfig {
  name: string;
  cwd?: string;
  /** Spawn a plain shell instead of claude (debug). */
  shell?: boolean;
}

/**
 * Mounts an xterm.js terminal into `hostRef` and streams it to a server PTY over
 * a WebSocket. Re-connects whenever the config identity changes.
 */
export function useTerminal(
  hostRef: React.RefObject<HTMLDivElement | null>,
  config: TerminalConfig,
  onExit?: (code: number | null) => void,
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

    const params = new URLSearchParams({ name: config.name });
    if (config.cwd) params.set("cwd", config.cwd);
    if (config.shell) params.set("shell", "1");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/ws/terminal?${params.toString()}`,
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
      else if (msg.type === "exit") {
        term.write(`\r\n\x1b[38;5;218m— session ended —\x1b[0m\r\n`);
        onExitRef.current?.(msg.code);
      }
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
    // Re-create the terminal when the target session identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.name, config.cwd, config.shell]);
}
