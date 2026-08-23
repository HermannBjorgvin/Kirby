import { useEffect, useRef, useState } from 'react';
import { Terminal, type TerminalHandle } from '@wterm/react';
import wasmUrl from '@wterm/core/wasm?url';

/**
 * One agent terminal: a wterm instance wired to the host PTY over
 * IPC. Keystrokes go out via writeSession; PTY bytes arrive via the
 * onSessionData event stream and are replayed into this terminal
 * while it is mounted.
 *
 * Scrollback for sessions that are backgrounded is kept by the host's
 * ring buffer of last output per session (see SessionTabs): we buffer
 * chunks in a ref and flush them on mount so switching tabs doesn't
 * lose output.
 */
export function SessionTerminal({
  name,
  active,
}: {
  name: string;
  active: boolean;
}) {
  const termRef = useRef<TerminalHandle>(null);
  const bufferRef = useRef<string[]>([]);
  const [ready, setReady] = useState(false);

  // Subscribe once; buffer while inactive.
  useEffect(() => {
    const offData = window.kirby.onSessionData(({ name: n, data }) => {
      if (n !== name) return;
      if (ready && active) {
        termRef.current?.write(data);
      } else {
        bufferRef.current.push(data);
        if (bufferRef.current.length > 500) bufferRef.current.shift();
      }
    });
    const offExit = window.kirby.onSessionExit(({ name: n }) => {
      if (n === name) {
        termRef.current?.write('\r\n\x1b[2m[session exited]\x1b[0m\r\n');
      }
    });
    return () => {
      offData();
      offExit();
    };
  }, [name, ready, active]);

  // Flush buffered output when the tab becomes visible again.
  useEffect(() => {
    if (!active || !ready) return;
    const pending = bufferRef.current;
    if (pending.length > 0) {
      for (const chunk of pending) termRef.current?.write(chunk);
      pending.length = 0;
    }
  }, [active, ready]);

  if (!active) return null;

  return (
    <div className="h-full min-h-0 w-full">
      <Terminal
        ref={termRef}
        wasmUrl={wasmUrl}
        className="!h-full !w-full !rounded-none !shadow-none"
        autoResize
        cursorBlink
        onReady={(wt) => {
          setReady(true);
          wt.focus();
          void window.kirby.resizeSession(name, wt.cols, wt.rows);
        }}
        onData={(data) => void window.kirby.writeSession(name, data)}
        onResize={(cols, rows) =>
          void window.kirby.resizeSession(name, cols, rows)
        }
      />
    </div>
  );
}
