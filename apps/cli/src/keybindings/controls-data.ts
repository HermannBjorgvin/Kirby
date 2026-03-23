import { ACTIONS, keysToDisplayString } from './index.js';
import type { InputContext, KeyDescriptor } from './index.js';

// ── Section config ─────────────────────────────────────────────────

const CONTEXT_LABELS: Record<InputContext, string> = {
  sidebar: 'Sidebar',
  settings: 'Settings',
  'branch-picker': 'Branch Picker',
  confirm: 'Confirm Dialog',
  'confirm-delete': 'Confirm Delete',
  'diff-file-list': 'Diff File List',
  'diff-viewer': 'Diff Viewer',
  controls: 'Controls',
};

const CONTEXT_ORDER: InputContext[] = [
  'sidebar',
  'diff-viewer',
  'diff-file-list',
  'settings',
  'branch-picker',
  'confirm',
  'confirm-delete',
];

// ── Row types ──────────────────────────────────────────────────────

export type ControlsRow =
  | { type: 'header'; label: string }
  | {
      type: 'binding';
      actionId: string;
      keys: string;
      label: string;
      isCustom: boolean;
    };

/** Build the flat list of rows for the controls panel */
export function buildControlsRows(
  bindings: Record<string, KeyDescriptor[]>,
  isCustom: (id: string) => boolean
): ControlsRow[] {
  const result: ControlsRow[] = [];

  for (const context of CONTEXT_ORDER) {
    const contextActions = ACTIONS.filter((a) => a.context === context);
    if (contextActions.length === 0) continue;

    result.push({ type: 'header', label: CONTEXT_LABELS[context] });

    for (const action of contextActions) {
      const descs = bindings[action.id];
      if (!descs || descs.length === 0) continue;
      result.push({
        type: 'binding',
        actionId: action.id,
        keys: keysToDisplayString(descs),
        label: action.label,
        isCustom: isCustom(action.id),
      });
    }
  }
  return result;
}

/** Get only binding rows (no headers), for index-based navigation */
export function getBindingRows(rows: ControlsRow[]) {
  return rows.filter(
    (r): r is Extract<ControlsRow, { type: 'binding' }> => r.type === 'binding'
  );
}
