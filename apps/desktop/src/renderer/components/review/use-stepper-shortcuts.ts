import { useEffect } from 'react';

export interface StepperShortcuts {
  onNext: () => void;
  onPrev: () => void;
  onEdit: () => void;
  onPost: () => void;
  onDiscard: () => void;
  onExit: () => void;
}

/**
 * Keyboard shortcuts for the review walkthrough.
 *
 * Ignored while editing the textarea, and while this tab is in the
 * background — `d` discards and `Enter` posts, so a stray keypress
 * elsewhere in the app must not reach them. The listener is on
 * `window` because the walkthrough has no single focused element to
 * hang it off, which is exactly why `enabled` has to be explicit: the
 * pane stays mounted behind other tabs (a live agent keeps its
 * terminal alive).
 */
export function useStepperShortcuts(
  enabled: boolean,
  handlers: StepperShortcuts
): void {
  const { onNext, onPrev, onEdit, onPost, onDiscard, onExit } = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j') {
        e.preventDefault();
        onNext();
      } else if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowLeft' ||
        e.key === 'k'
      ) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'e') {
        e.preventDefault();
        onEdit();
      } else if (e.key === 'p' || e.key === 'Enter') {
        e.preventDefault();
        onPost();
      } else if (e.key === 'd') {
        e.preventDefault();
        onDiscard();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onNext, onPrev, onEdit, onPost, onDiscard, onExit]);
}
