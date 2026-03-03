import { useEffect, useRef, useCallback, useState } from 'react';
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
  const [mouseMode, setMouseMode] = useState<
    'none' | 'x10' | 'vt200' | 'drag' | 'any'
  >('none');
  const scrollOffsetRef = useRef(0);

  const scheduleRender = useCallback(() => {
    if (renderTimer.current) return;
    renderTimer.current = setTimeout(() => {
      renderTimer.current = null;
      const entry = entryRef.current;
      if (entry) {
        const rendered = entry.emu.render(scrollOffsetRef.current);
        if (entry.exited) {
          setPaneContentRef.current(
            rendered + `\n\n(process exited with code ${entry.exitCode ?? '?'})`
          );
        } else {
          setPaneContentRef.current(rendered);
        }
        // Mirror child's mouse tracking mode
        const mode = entry.emu.mouseTrackingMode;
        setMouseMode((prev) => (prev !== mode ? mode : prev));
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
    const onRender = () => scheduleRender();
    entry.emu.onRender(onRender);

    // Initial render
    scheduleRender();

    return () => {
      entry.emu.offRender(onRender);
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
      // Reset scroll position on user input
      scrollOffsetRef.current = 0;
      entry.pty.write(data);
    }
  }, []);

  const scrollUp = useCallback(() => {
    const entry = entryRef.current;
    if (!entry) return;
    const max = entry.emu.maxScrollback;
    const next = Math.min(scrollOffsetRef.current + 3, max);
    scrollOffsetRef.current = next;
    scheduleRender();
  }, [scheduleRender]);

  const scrollDown = useCallback(() => {
    const next = Math.max(scrollOffsetRef.current - 3, 0);
    scrollOffsetRef.current = next;
    scheduleRender();
  }, [scheduleRender]);

  return {
    write,
    mouseMode,
    scrollUp,
    scrollDown,
  };
}
