import { useCallback, useMemo, useState } from 'react';
import { usePlanStore } from '@kirby/app-core/plan';
import {
  add,
  annotate,
  clear,
  planItemKey,
  remove,
  toggle,
  type PlanItem,
} from '@kirby/core/plan';
import { toast } from 'sonner';

/**
 * The renderer's view of the plan — the queue of review comments the
 * user is assembling for one agent to work through.
 *
 * The store itself is @kirby/core's, shared with the TUI, and the
 * useSyncExternalStore binding is @kirby/app-core's. Everything here is
 * the desktop's own ergonomics on top: operations bound to one pull
 * request, and the add/remove interactions the cards share.
 *
 * The queue lives only in this window's memory, exactly as it does in
 * the TUI: it survives closing and reopening a tab, and is gone when
 * the app is.
 */

const NO_ITEMS: PlanItem[] = [];

export interface PlanApi {
  /** Queued items for this PR, in the order they were added. */
  items: PlanItem[];
  count: number;
  has: (kind: PlanItem['kind'], id: string) => boolean;
  /** The note on a queued comment, if it carries one. */
  noteFor: (kind: PlanItem['kind'], id: string) => string | undefined;
  add: (item: PlanItem) => void;
  /** Removes, and offers an undo — a note is easy to lose by misclick. */
  removeWithUndo: (item: PlanItem) => void;
  toggle: (item: PlanItem) => boolean;
  annotate: (kind: PlanItem['kind'], id: string, note: string) => void;
  clear: () => void;
}

export function usePlan(prId: number): PlanApi {
  const { snapshot } = usePlanStore();
  const items = useMemo(() => snapshot.get(prId) ?? NO_ITEMS, [snapshot, prId]);

  return useMemo(() => {
    const keys = new Set(items.map((i) => planItemKey(i.kind, i.id)));
    const find = (kind: PlanItem['kind'], id: string) =>
      items.find((i) => i.kind === kind && i.id === id);
    return {
      items,
      count: items.length,
      has: (kind, id) => keys.has(planItemKey(kind, id)),
      noteFor: (kind, id) => find(kind, id)?.annotation,
      add: (item) => add(prId, item),
      removeWithUndo: (item) => {
        remove(prId, item.kind, item.id);
        toast('Removed from plan', {
          action: { label: 'Undo', onClick: () => add(prId, item) },
        });
      },
      toggle: (item) => toggle(prId, item),
      annotate: (kind, id, note) => annotate(prId, kind, id, note),
      clear: () => clear(prId),
    };
  }, [items, prId]);
}

/**
 * How many comments are queued for a pull request — for callers that
 * want the number and nothing else (the tab strip). Separate from
 * `usePlan` so a tab does not rebuild the whole bound API per render.
 */
export function usePlanCount(prId: number | undefined): number {
  const { snapshot } = usePlanStore();
  return prId == null ? 0 : snapshot.get(prId)?.length ?? 0;
}

/**
 * One comment's plan controls: whether it is queued, and the note
 * composer that opens beside it.
 *
 * `snapshot` is a factory rather than a value because a plan item is a
 * copy taken at add-time — building one on every render would be waste,
 * and (worse) invite passing a stale one to `add`.
 *
 * Opening the composer *adds the comment first*, matching the TUI: the
 * note is an embellishment on an add that has already happened, which
 * is why cancelling closes the composer and leaves the comment queued.
 */
export function usePlanControls(
  plan: PlanApi,
  kind: PlanItem['kind'],
  id: string,
  snapshot: () => PlanItem
) {
  const [composing, setComposing] = useState(false);
  const inPlan = plan.has(kind, id);
  const note = plan.noteFor(kind, id);

  const toggleInPlan = useCallback(() => {
    const item = snapshot();
    if (plan.has(kind, id)) {
      setComposing(false);
      plan.removeWithUndo(item);
    } else {
      plan.add(item);
    }
  }, [plan, kind, id, snapshot]);

  const startNote = useCallback(() => {
    // Re-adding refreshes the snapshot and keeps any existing note, so
    // this is safe whether or not the comment is already queued.
    plan.add(snapshot());
    setComposing(true);
  }, [plan, snapshot]);

  const saveNote = useCallback(
    (text: string) => {
      plan.annotate(kind, id, text);
      setComposing(false);
    },
    [plan, kind, id]
  );

  return {
    inPlan,
    note,
    composing,
    toggleInPlan,
    startNote,
    saveNote,
    cancelNote: useCallback(() => setComposing(false), []),
  };
}
