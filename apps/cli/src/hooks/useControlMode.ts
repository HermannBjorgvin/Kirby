import { useEffect, useRef, useCallback } from 'react';
import type { Key } from 'ink';
import { hasSession } from '@kirby/tmux-manager';
import { ControlConnection } from '@kirby/tmux-control';

export function useControlMode(
  sessionName: string | null,
  paneCols: number,
  paneRows: number,
  setPaneContent: (content: string) => void,
  reconnectKey: number
) {
  const connRef = useRef<ControlConnection | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs so the connection effect can read latest values
  // without needing them in its dependency array
  const setPaneContentRef = useRef(setPaneContent);
  setPaneContentRef.current = setPaneContent;

  const paneRowsRef = useRef(paneRows);
  paneRowsRef.current = paneRows;

  const clampContent = useCallback((raw: string) => {
    const rows = paneRowsRef.current;
    const lines = raw.split('\n');
    return lines.length > rows ? lines.slice(0, rows).join('\n') : raw;
  }, []);

  const scheduleRender = useCallback(() => {
    if (renderTimer.current) return;
    renderTimer.current = setTimeout(() => {
      renderTimer.current = null;
      const conn = connRef.current;
      if (conn && conn.state === 'ready') {
        conn.capturePane().then(
          (content) => {
            // Only update if this connection is still the active one
            if (connRef.current === conn) {
              setPaneContentRef.current(clampContent(content));
            }
          },
          () => {
            // Connection died between check and capture — ignore
          }
        );
      }
    }, 16); // ~60fps
  }, [clampContent]);

  useEffect(() => {
    if (!sessionName) return;

    let cancelled = false;

    (async () => {
      // Don't connect if the tmux session doesn't exist yet —
      // it will be auto-created when the user tabs into the terminal pane
      if (!(await hasSession(sessionName))) {
        if (!cancelled)
          setPaneContentRef.current('(press Tab to start session)');
        return;
      }
      if (cancelled) return;

      const conn = new ControlConnection(sessionName);
      connRef.current = conn;

      conn.on('output', () => {
        scheduleRender();
      });

      conn.on('exit', () => {
        setPaneContentRef.current('(session disconnected)');
      });

      conn.on('error', () => {
        setPaneContentRef.current('(connection error)');
      });

      conn
        .connect(paneCols, paneRows)
        .then(async () => {
          const content = await conn.capturePane();
          if (connRef.current === conn) {
            setPaneContentRef.current(clampContent(content));
          }
        })
        .catch(() => {
          setPaneContentRef.current('(failed to connect)');
        });
    })();

    return () => {
      cancelled = true;
      if (renderTimer.current) {
        clearTimeout(renderTimer.current);
        renderTimer.current = null;
      }
      const conn = connRef.current;
      if (conn) {
        conn.disconnect();
        connRef.current = null;
      }
    };
  }, [
    sessionName,
    reconnectKey,
    paneCols,
    paneRows,
    clampContent,
    scheduleRender,
  ]);

  useEffect(() => {
    const conn = connRef.current;
    if (conn && conn.state === 'ready') {
      conn.resize(paneCols, paneRows);
      scheduleRender();
    }
  }, [paneCols, paneRows, scheduleRender]);

  const sendInput = useCallback((input: string, key: Key) => {
    const conn = connRef.current;
    if (!conn || conn.state !== 'ready') return;

    if (key.return) {
      conn.sendKeys('Enter');
    } else if (key.backspace || key.delete) {
      conn.sendKeys('BSpace');
    } else if (key.upArrow) {
      conn.sendKeys('Up');
    } else if (key.downArrow) {
      conn.sendKeys('Down');
    } else if (key.leftArrow) {
      conn.sendKeys('Left');
    } else if (key.rightArrow) {
      conn.sendKeys('Right');
    } else if (key.tab) {
      // Tab is reserved for focus switching, don't forward
    } else if (key.ctrl && input === 'c') {
      conn.sendKeys('C-c');
    } else if (input) {
      conn.sendLiteral(input);
    }
  }, []);

  return { sendInput };
}
