import { useEffect, useRef, useState } from 'react';
import { Terminal, type TerminalHandle } from '@wterm/react';
import wasmUrl from '@wterm/core/wasm?url';
import {
  estimateTerminalGrid,
  measureTerminalGrid,
} from '../../lib/terminal-grid.js';
import { useTheme } from '../../lib/theme.js';

/**
 * One agent terminal bound to a host PTY. The component stays mounted
 * for as long as its tab is open (the editor hides inactive panes with
 * `visibility`), so the wterm instance keeps the full scrollback.
 *
 * On mount we replay the host's ring buffer for the session, then
 * stream live chunks — `seq` ordering lets us drop any live chunk that
 * was already part of the snapshot.
 */
export function SessionTerminal({
  name,
  active,
}: {
  name: string;
  active: boolean;
}) {
  const termRef = useRef<TerminalHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const { resolved } = useTheme();

  useEffect(() => {
    if (!ready) return;
    const term = termRef.current;
    if (!term) return;

    let snapshotSeq: number | null = null;
    const pending: { seq: number; data: string }[] = [];

    const offData = window.kirby.onSessionData(({ name: n, data, seq }) => {
      if (n !== name) return;
      if (snapshotSeq === null) {
        pending.push({ seq, data });
      } else if (seq > snapshotSeq) {
        term.write(data);
      }
    });
    const offExit = window.kirby.onSessionExit(({ name: n, code }) => {
      if (n === name) {
        term.write(
          `\r\n\x1b[2m[session exited${
            code ? ` with code ${code}` : ''
          }]\x1b[0m\r\n`
        );
      }
    });

    void window.kirby
      .getSessionBuffer(name)
      .then(({ data, seq }) => {
        if (data) term.write(data);
        snapshotSeq = seq;
        for (const chunk of pending) {
          if (chunk.seq > seq) term.write(chunk.data);
        }
        pending.length = 0;
      })
      .catch(() => {
        snapshotSeq = 0;
        for (const chunk of pending) term.write(chunk.data);
        pending.length = 0;
      });

    return () => {
      offData();
      offExit();
    };
  }, [name, ready]);

  // Grab keyboard focus whenever this pane becomes the active tab.
  useEffect(() => {
    if (active && ready) termRef.current?.focus();
  }, [active, ready]);

  // Fit the terminal grid to its pane. autoResize stays ON (with it off
  // the react wrapper pins an inline height of rows*17px and keeps
  // re-applying its cols/rows props, clamping the terminal to ~24 rows).
  // wterm's own observer can still latch a stale size when the pane
  // mounts before layout settles, so this extra observer nudges
  // resize() from the wrapper's real box whenever it changes, using
  // wterm's measured cell metrics so the two observers agree.
  //
  // When the pane becomes the active tab again, a same-size resize is a
  // no-op all the way down (wterm repaints only dirty rows and the PTY
  // skips a same-size SIGWINCH), so the terminal can come back stale or
  // blank. Bouncing the grid one row forces the app to repaint the
  // whole screen — the same thing a manual window resize did.
  useEffect(() => {
    if (!ready) return;
    const el = wrapRef.current;
    const term = termRef.current;
    const inst = term?.instance;
    if (!el || !term || !inst) return;
    let raf = 0;
    const fit = (forceRepaint = false) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        const grid =
          measureTerminalGrid(inst.element, rect) ?? estimateTerminalGrid(rect);
        if (grid.cols !== inst.cols || grid.rows !== inst.rows) {
          term.resize(grid.cols, grid.rows);
        } else if (forceRepaint) {
          term.resize(grid.cols, grid.rows - 1);
          raf = requestAnimationFrame(() => term.resize(grid.cols, grid.rows));
        }
      });
    };
    fit(active);
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ready, active]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <Terminal
        ref={termRef}
        wasmUrl={wasmUrl}
        className="h-full w-full"
        theme={resolved === 'light' ? 'light' : undefined}
        autoResize
        cursorBlink
        onReady={(wt) => {
          setReady(true);
          if (active) wt.focus();
        }}
        onData={(data) => void window.kirby.writeSession(name, data)}
        onResize={(cols, rows) =>
          void window.kirby.resizeSession(name, cols, rows)
        }
      />
    </div>
  );
}
