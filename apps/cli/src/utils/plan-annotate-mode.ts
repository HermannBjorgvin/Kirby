import type { Key } from 'ink';
import { handleTextInput } from './handle-text-input.js';
import type { PlanValue } from '../context/PlanContext.js';
import type { PlanItem } from '../plan/plan-types.js';

// Shared plan-annotation input handling.
//
// Three surfaces host the same single-line note composer: the diff
// viewer (Shift+A), the diff file list (Shift+A), and the checkout
// pane ([a] on a row). All operate on an item already in the plan,
// identified by `annotatingPlanKey` (a `${kind}:${id}` key). Enter
// commits the note, Esc cancels, any other key edits the buffer.

export interface PlanAnnotatePane {
  annotatingPlanKey: string | null;
  annotationBuffer: string;
  setAnnotatingPlanKey: (key: string | null) => void;
  setAnnotationBuffer: (next: string | ((prev: string) => string)) => void;
}

export interface PlanAnnotateDeps {
  pane: PlanAnnotatePane;
  plan: PlanValue;
  prId: number | undefined;
}

/** Split a `${kind}:${id}` plan key back into its parts. */
function parseKey(key: string): { kind: PlanItem['kind']; id: string } | null {
  const idx = key.indexOf(':');
  if (idx < 0) return null;
  const kind = key.slice(0, idx);
  if (kind !== 'remote' && kind !== 'local') return null;
  return { kind, id: key.slice(idx + 1) };
}

/**
 * Returns `true` when the input was consumed by annotation mode (caller
 * should return without running its normal dispatch). Returns `false`
 * when annotation mode isn't active — caller proceeds as usual.
 */
export function handlePlanAnnotateInput(
  input: string,
  key: Key,
  deps: PlanAnnotateDeps
): boolean {
  const { pane, plan, prId } = deps;
  if (!pane.annotatingPlanKey) return false;

  if (key.escape) {
    pane.setAnnotatingPlanKey(null);
    pane.setAnnotationBuffer('');
    return true;
  }

  if (key.return) {
    const parsed = parseKey(pane.annotatingPlanKey);
    if (parsed && prId != null) {
      plan.annotate(prId, parsed.kind, parsed.id, pane.annotationBuffer);
    }
    pane.setAnnotatingPlanKey(null);
    pane.setAnnotationBuffer('');
    return true;
  }

  handleTextInput(input, key, pane.setAnnotationBuffer);
  return true;
}
