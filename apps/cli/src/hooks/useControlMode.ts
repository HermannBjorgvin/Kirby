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

  const clampContent = useCallback(
    (raw: string) => {
      const lines = raw.split('\n');
      return lines.length > paneRows
        ? lines.slice(0, paneRows).join('\n')
        : raw;
    },
    [paneRows]
  );

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
              setPaneContent(clampContent(content));
            }
          },
          () => {
            // Connection died between check and capture — ignore
          }
        );
      }
    }, 16); // ~60fps
  }, [setPaneContent, clampContent]);

  useEffect(() => {
    if (!sessionName) return;

    // Don't connect if the tmux session doesn't exist yet —
    // it will be auto-created when the user tabs into the terminal pane
    if (!hasSession(sessionName)) {
      setPaneContent('(press Tab to start session)');
      return;
    }

    const conn = new ControlConnection(sessionName);
    connRef.current = conn;

    conn.on('output', () => {
      scheduleRender();
    });

    conn.on('exit', () => {
      setPaneContent('(session disconnected)');
    });

    conn.on('error', () => {
      setPaneContent('(connection error)');
    });

    conn
      .connect(paneCols, paneRows)
      .then(async () => {
        const content = await conn.capturePane();
        if (connRef.current === conn) {
          setPaneContent(clampContent(content));
        }
      })
      .catch(() => {
        setPaneContent('(failed to connect)');
      });

    return () => {
      if (renderTimer.current) {
        clearTimeout(renderTimer.current);
        renderTimer.current = null;
      }
      conn.disconnect();
      connRef.current = null;
    };
    // Only reconnect when the session changes (or reconnectKey bumps after auto-create)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName, reconnectKey]);

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
