import { useEffect, useRef, useCallback } from 'react';
import { getSession } from '../pty-registry.js';
import type { PtyEntry } from '../pty-registry.js';

export function usePtySession(
  sessionName: string | null,
  paneCols: number,
  paneRows: number,
  setPaneContent: (content: string) => void,
  reconnectKey: number
) {
  const entryRef = useRef<PtyEntry | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPaneContentRef = useRef(setPaneContent);
  setPaneContentRef.current = setPaneContent;

  const scheduleRender = useCallback(() => {
    if (renderTimer.current) return;
    renderTimer.current = setTimeout(() => {
      renderTimer.current = null;
      const entry = entryRef.current;
      if (entry) {
        const rendered = entry.emu.render();
        if (entry.exited) {
          setPaneContentRef.current(
            rendered + `\n\n(process exited with code ${entry.exitCode ?? '?'})`
          );
        } else {
          setPaneContentRef.current(rendered);
        }
      }
    }, 16); // ~60fps
  }, []);

  useEffect(() => {
    if (!sessionName) return;

    const entry = getSession(sessionName);
    if (!entry) {
      setPaneContentRef.current('(press Tab to start session)');
      return;
    }

    entryRef.current = entry;

    // Subscribe to render events
    entry.emu.onRender(() => {
      scheduleRender();
    });

    // Initial render
    scheduleRender();

    return () => {
      if (renderTimer.current) {
        clearTimeout(renderTimer.current);
        renderTimer.current = null;
      }
      entryRef.current = null;
    };
  }, [sessionName, reconnectKey, scheduleRender]);

  // Handle resize
  useEffect(() => {
    const entry = entryRef.current;
    if (entry && !entry.exited) {
      entry.pty.resize(paneCols, paneRows);
      entry.emu.resize(paneCols, paneRows);
      scheduleRender();
    }
  }, [paneCols, paneRows, scheduleRender]);

  const write = useCallback((data: string) => {
    const entry = entryRef.current;
    if (entry && !entry.exited) {
      entry.pty.write(data);
    }
  }, []);

  return { write };
}
