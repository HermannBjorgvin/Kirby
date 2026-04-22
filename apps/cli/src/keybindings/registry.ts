import type { Key } from 'ink';

// ── Types ──────────────────────────────────────────────────────────

/** A single key binding descriptor */
export interface KeyDescriptor {
  /** The character from the `input` param (e.g. 'j', 'q'). Omit for non-character keys. */
  input?: string;
  /** Which Key boolean flags must be true (e.g. { downArrow: true }) */
  flags?: Partial<
    Pick<
      Key,
      | 'upArrow'
      | 'downArrow'
      | 'leftArrow'
      | 'rightArrow'
      | 'return'
      | 'escape'
      | 'tab'
      | 'backspace'
      | 'delete'
      | 'pageDown'
      | 'pageUp'
      | 'home'
      | 'end'
    >
  >;
  /** Require Ctrl modifier */
  ctrl?: boolean;
  /** Require Shift modifier */
  shift?: boolean;
  /** Require Alt/Meta modifier */
  meta?: boolean;
}

export type InputContext =
  | 'sidebar'
  | 'settings'
  | 'branch-picker'
  | 'confirm'
  | 'confirm-delete'
  | 'diff-file-list'
  | 'diff-viewer'
  | 'controls';

/** A bindable action in the application */
export interface ActionDef {
  id: string;
  label: string;
  context: InputContext;
  /** Short hint text for the sidebar keybind display */
  hintLabel?: string;
  /** Whether this action appears in sidebar/panel keybind hints */
  showInHints?: boolean;
  /** Only show this hint when VCS is configured */
  vcsOnly?: boolean;
}

export interface KeybindPreset {
  id: string;
  name: string;
  bindings: Record<string, KeyDescriptor[]>;
}

// ── Action Catalog ─────────────────────────────────────────────────

export const ACTIONS = [
  // ── Sidebar ──
  {
    id: 'sidebar.navigate-down',
    label: 'Navigate down',
    context: 'sidebar',
    hintLabel: 'navigate',
    showInHints: true,
  },
  {
    id: 'sidebar.navigate-up',
    label: 'Navigate up',
    context: 'sidebar',
  },
  {
    id: 'sidebar.jump-next-active',
    label: 'Jump to next active session',
    context: 'sidebar',
  },
  {
    id: 'sidebar.jump-prev-active',
    label: 'Jump to previous active session',
    context: 'sidebar',
  },
  {
    id: 'sidebar.quit',
    label: 'Quit',
    context: 'sidebar',
    hintLabel: 'quit',
    showInHints: true,
  },
  {
    id: 'sidebar.checkout-branch',
    label: 'Checkout branch',
    context: 'sidebar',
    hintLabel: 'checkout branch',
    showInHints: true,
  },
  {
    id: 'sidebar.delete-branch',
    label: 'Delete branch',
    context: 'sidebar',
    hintLabel: 'delete branch',
    showInHints: true,
  },
  {
    id: 'sidebar.kill-agent',
    label: 'Kill agent',
    context: 'sidebar',
    hintLabel: 'kill agent',
    showInHints: true,
  },
  {
    id: 'sidebar.open-settings',
    label: 'Settings',
    context: 'sidebar',
    hintLabel: 'settings',
    showInHints: true,
  },
  {
    id: 'sidebar.refresh-pr',
    label: 'Refresh PR data',
    context: 'sidebar',
    hintLabel: 'refresh PR data',
    showInHints: true,
    vcsOnly: true,
  },
  {
    id: 'sidebar.rebase',
    label: 'Rebase onto master',
    context: 'sidebar',
    hintLabel: 'rebase onto master',
    showInHints: true,
  },
  {
    id: 'sidebar.open-editor',
    label: 'Open in editor',
    context: 'sidebar',
    hintLabel: 'open in editor',
    showInHints: true,
  },
  {
    id: 'sidebar.sync-origin',
    label: 'Sync with origin',
    context: 'sidebar',
    hintLabel: 'sync with origin',
    showInHints: true,
    vcsOnly: true,
  },
  {
    id: 'sidebar.view-diff',
    label: 'View diff',
    context: 'sidebar',
    hintLabel: 'view diff',
    showInHints: true,
    vcsOnly: true,
  },
  {
    id: 'sidebar.start-session',
    label: 'Start/focus session',
    context: 'sidebar',
    hintLabel: 'start/focus session',
    showInHints: true,
  },
  {
    id: 'sidebar.focus-terminal',
    label: 'Focus terminal',
    context: 'sidebar',
  },
  {
    id: 'sidebar.toggle-hints',
    label: 'Toggle hint visibility',
    context: 'sidebar',
    hintLabel: 'hide hints',
    showInHints: true,
  },

  // ── Settings ──
  {
    id: 'settings.navigate-down',
    label: 'Navigate down',
    context: 'settings',
  },
  {
    id: 'settings.navigate-up',
    label: 'Navigate up',
    context: 'settings',
  },
  { id: 'settings.close', label: 'Close settings', context: 'settings' },
  {
    id: 'settings.cycle-left',
    label: 'Cycle preset left',
    context: 'settings',
  },
  {
    id: 'settings.cycle-right',
    label: 'Cycle preset right',
    context: 'settings',
  },
  { id: 'settings.edit-toggle', label: 'Edit/toggle', context: 'settings' },
  { id: 'settings.auto-detect', label: 'Auto-detect', context: 'settings' },

  // ── Branch Picker ──
  { id: 'branch-picker.cancel', label: 'Cancel', context: 'branch-picker' },
  {
    id: 'branch-picker.navigate-up',
    label: 'Navigate up',
    context: 'branch-picker',
  },
  {
    id: 'branch-picker.navigate-down',
    label: 'Navigate down',
    context: 'branch-picker',
  },
  { id: 'branch-picker.select', label: 'Select', context: 'branch-picker' },
  {
    id: 'branch-picker.fetch',
    label: 'Fetch remotes',
    context: 'branch-picker',
  },

  // ── Confirm Dialog ──
  { id: 'confirm.navigate-down', label: 'Navigate down', context: 'confirm' },
  { id: 'confirm.navigate-up', label: 'Navigate up', context: 'confirm' },
  { id: 'confirm.cancel', label: 'Cancel', context: 'confirm' },
  { id: 'confirm.select', label: 'Select', context: 'confirm' },

  // ── Confirm Delete ──
  {
    id: 'confirm-delete.cancel',
    label: 'Cancel',
    context: 'confirm-delete',
  },
  {
    id: 'confirm-delete.confirm',
    label: 'Confirm',
    context: 'confirm-delete',
  },

  // ── Diff File List ──
  { id: 'diff-file-list.back', label: 'Back', context: 'diff-file-list' },
  {
    id: 'diff-file-list.navigate-down',
    label: 'Navigate down',
    context: 'diff-file-list',
  },
  {
    id: 'diff-file-list.navigate-up',
    label: 'Navigate up',
    context: 'diff-file-list',
  },
  {
    id: 'diff-file-list.toggle-skipped',
    label: 'Toggle skipped',
    context: 'diff-file-list',
  },
  { id: 'diff-file-list.open', label: 'Open file', context: 'diff-file-list' },

  // ── Diff Viewer ──
  {
    id: 'diff-viewer.scroll-down',
    label: 'Scroll down',
    context: 'diff-viewer',
  },
  { id: 'diff-viewer.scroll-up', label: 'Scroll up', context: 'diff-viewer' },
  {
    id: 'diff-viewer.half-page-down',
    label: 'Half page down',
    context: 'diff-viewer',
  },
  {
    id: 'diff-viewer.half-page-up',
    label: 'Half page up',
    context: 'diff-viewer',
  },
  { id: 'diff-viewer.go-top', label: 'Go to top', context: 'diff-viewer' },
  {
    id: 'diff-viewer.go-bottom',
    label: 'Go to bottom',
    context: 'diff-viewer',
  },
  { id: 'diff-viewer.next-file', label: 'Next file', context: 'diff-viewer' },
  {
    id: 'diff-viewer.prev-file',
    label: 'Previous file',
    context: 'diff-viewer',
  },
  {
    id: 'diff-viewer.next-comment',
    label: 'Next comment',
    context: 'diff-viewer',
  },
  {
    id: 'diff-viewer.prev-comment',
    label: 'Previous comment',
    context: 'diff-viewer',
  },
  {
    id: 'diff-viewer.delete-comment',
    label: 'Delete comment',
    context: 'diff-viewer',
  },
  {
    id: 'diff-viewer.edit-comment',
    label: 'Inline edit',
    context: 'diff-viewer',
  },
  {
    id: 'diff-viewer.post-comment',
    label: 'Post comment',
    context: 'diff-viewer',
  },
  {
    id: 'diff-viewer.editor-edit',
    label: 'Edit in editor',
    context: 'diff-viewer',
  },
  { id: 'diff-viewer.back', label: 'Back', context: 'diff-viewer' },

  // ── Controls ──
  { id: 'controls.navigate-down', label: 'Navigate down', context: 'controls' },
  { id: 'controls.navigate-up', label: 'Navigate up', context: 'controls' },
  { id: 'controls.close', label: 'Back', context: 'controls' },
  { id: 'controls.rebind', label: 'Rebind', context: 'controls' },
  { id: 'controls.cycle-left', label: 'Previous preset', context: 'controls' },
  { id: 'controls.cycle-right', label: 'Next preset', context: 'controls' },
] as const satisfies readonly ActionDef[];

/** Derived union of all action ID strings */
export type ActionId = (typeof ACTIONS)[number]['id'];

// ── Presets ─────────────────────────────────────────────────────────

export const NORMIE_PRESET: KeybindPreset = {
  id: 'normie',
  name: 'Normie defaults',
  bindings: {
    // Sidebar
    'sidebar.navigate-down': [{ flags: { downArrow: true } }],
    'sidebar.navigate-up': [{ flags: { upArrow: true } }],
    'sidebar.jump-next-active': [{ shift: true, flags: { downArrow: true } }],
    'sidebar.jump-prev-active': [{ shift: true, flags: { upArrow: true } }],
    'sidebar.quit': [{ input: 'q' }],
    'sidebar.checkout-branch': [{ input: 'c' }],
    'sidebar.delete-branch': [
      { flags: { delete: true } },
      { flags: { backspace: true } },
    ],
    'sidebar.kill-agent': [{ input: 'K', shift: true }],
    'sidebar.open-settings': [{ input: 's' }],
    'sidebar.refresh-pr': [{ input: 'r' }],
    'sidebar.rebase': [{ input: 'u' }],
    'sidebar.open-editor': [{ input: 'E', shift: true }],
    'sidebar.sync-origin': [{ input: 'f' }],
    'sidebar.view-diff': [{ input: 'd' }],
    'sidebar.start-session': [{ flags: { return: true } }],
    'sidebar.focus-terminal': [{ flags: { tab: true } }],
    'sidebar.toggle-hints': [{ input: '?' }],

    // Settings
    'settings.navigate-down': [{ flags: { downArrow: true } }],
    'settings.navigate-up': [{ flags: { upArrow: true } }],
    'settings.close': [{ flags: { escape: true } }],
    'settings.cycle-left': [{ flags: { leftArrow: true } }],
    'settings.cycle-right': [{ flags: { rightArrow: true } }],
    'settings.edit-toggle': [{ flags: { return: true } }],
    'settings.auto-detect': [{ input: 'a' }],

    // Branch Picker
    'branch-picker.cancel': [{ flags: { escape: true } }],
    'branch-picker.navigate-up': [{ flags: { upArrow: true } }],
    'branch-picker.navigate-down': [{ flags: { downArrow: true } }],
    'branch-picker.select': [{ flags: { return: true } }],
    'branch-picker.fetch': [{ input: 'f', ctrl: true }],

    // Confirm Dialog
    'confirm.navigate-down': [{ flags: { downArrow: true } }],
    'confirm.navigate-up': [{ flags: { upArrow: true } }],
    'confirm.cancel': [{ flags: { escape: true } }],
    'confirm.select': [{ flags: { return: true } }],

    // Confirm Delete
    'confirm-delete.cancel': [{ flags: { escape: true } }],
    'confirm-delete.confirm': [{ flags: { return: true } }],

    // Diff File List
    'diff-file-list.back': [{ flags: { escape: true } }],
    'diff-file-list.navigate-down': [{ flags: { downArrow: true } }],
    'diff-file-list.navigate-up': [{ flags: { upArrow: true } }],
    'diff-file-list.toggle-skipped': [{ input: 's' }],
    'diff-file-list.open': [{ flags: { return: true } }],

    // Diff Viewer
    'diff-viewer.scroll-down': [{ flags: { downArrow: true } }],
    'diff-viewer.scroll-up': [{ flags: { upArrow: true } }],
    'diff-viewer.half-page-down': [{ flags: { pageDown: true } }],
    'diff-viewer.half-page-up': [{ flags: { pageUp: true } }],
    'diff-viewer.go-top': [{ flags: { home: true } }],
    'diff-viewer.go-bottom': [{ flags: { end: true } }],
    'diff-viewer.next-file': [{ flags: { rightArrow: true } }],
    'diff-viewer.prev-file': [{ flags: { leftArrow: true } }],
    'diff-viewer.next-comment': [{ shift: true, flags: { downArrow: true } }],
    'diff-viewer.prev-comment': [{ shift: true, flags: { upArrow: true } }],
    'diff-viewer.delete-comment': [{ flags: { delete: true } }],
    'diff-viewer.edit-comment': [{ input: 'e' }],
    'diff-viewer.post-comment': [{ input: 'p' }],
    'diff-viewer.editor-edit': [{ input: 'E', shift: true }],
    'diff-viewer.back': [{ flags: { escape: true } }],

    // Controls
    'controls.navigate-down': [{ flags: { downArrow: true } }],
    'controls.navigate-up': [{ flags: { upArrow: true } }],
    'controls.close': [{ flags: { escape: true } }],
    'controls.rebind': [{ flags: { return: true } }],
    'controls.cycle-left': [{ flags: { leftArrow: true } }],
    'controls.cycle-right': [{ flags: { rightArrow: true } }],
  },
};

export const VIM_PRESET: KeybindPreset = {
  id: 'vim',
  name: 'Vim Losers',
  bindings: {
    // Sidebar
    'sidebar.navigate-down': [{ input: 'j' }, { flags: { downArrow: true } }],
    'sidebar.navigate-up': [{ input: 'k' }, { flags: { upArrow: true } }],
    'sidebar.jump-next-active': [{ shift: true, flags: { downArrow: true } }],
    'sidebar.jump-prev-active': [{ shift: true, flags: { upArrow: true } }],
    'sidebar.quit': [{ input: 'q' }],
    'sidebar.checkout-branch': [{ input: 'c' }],
    'sidebar.delete-branch': [{ input: 'x' }],
    'sidebar.kill-agent': [{ input: 'K' }],
    'sidebar.open-settings': [{ input: 's' }],
    'sidebar.refresh-pr': [{ input: 'r' }],
    'sidebar.rebase': [{ input: 'u' }],
    'sidebar.open-editor': [{ input: '.' }],
    'sidebar.sync-origin': [{ input: 'g' }],
    'sidebar.view-diff': [{ input: 'd' }],
    'sidebar.start-session': [{ flags: { return: true } }],
    'sidebar.focus-terminal': [{ flags: { tab: true } }],
    'sidebar.toggle-hints': [{ input: '?' }],

    // Settings (same as normie — transient modal)
    'settings.navigate-down': [{ input: 'j' }, { flags: { downArrow: true } }],
    'settings.navigate-up': [{ input: 'k' }, { flags: { upArrow: true } }],
    'settings.close': [{ flags: { escape: true } }],
    'settings.cycle-left': [{ flags: { leftArrow: true } }],
    'settings.cycle-right': [{ flags: { rightArrow: true } }],
    'settings.edit-toggle': [{ flags: { return: true } }],
    'settings.auto-detect': [{ input: 'a' }],

    // Branch Picker (same as normie)
    'branch-picker.cancel': [{ flags: { escape: true } }],
    'branch-picker.navigate-up': [{ flags: { upArrow: true } }],
    'branch-picker.navigate-down': [{ flags: { downArrow: true } }],
    'branch-picker.select': [{ flags: { return: true } }],
    'branch-picker.fetch': [{ input: 'f', ctrl: true }],

    // Confirm Dialog (same as normie)
    'confirm.navigate-down': [{ input: 'j' }, { flags: { downArrow: true } }],
    'confirm.navigate-up': [{ input: 'k' }, { flags: { upArrow: true } }],
    'confirm.cancel': [{ flags: { escape: true } }],
    'confirm.select': [{ flags: { return: true } }],

    // Confirm Delete (same as normie)
    'confirm-delete.cancel': [{ flags: { escape: true } }],
    'confirm-delete.confirm': [{ flags: { return: true } }],

    // Diff File List
    'diff-file-list.back': [{ flags: { escape: true } }],
    'diff-file-list.navigate-down': [
      { input: 'j' },
      { flags: { downArrow: true } },
    ],
    'diff-file-list.navigate-up': [
      { input: 'k' },
      { flags: { upArrow: true } },
    ],
    'diff-file-list.toggle-skipped': [{ input: 's' }],
    'diff-file-list.open': [{ flags: { return: true } }],

    // Diff Viewer
    'diff-viewer.scroll-down': [{ input: 'j' }, { flags: { downArrow: true } }],
    'diff-viewer.scroll-up': [{ input: 'k' }, { flags: { upArrow: true } }],
    'diff-viewer.half-page-down': [{ input: 'd' }],
    'diff-viewer.half-page-up': [{ input: 'u' }],
    'diff-viewer.go-top': [{ input: 'g' }],
    'diff-viewer.go-bottom': [{ input: 'G' }],
    'diff-viewer.next-file': [{ input: 'n' }],
    'diff-viewer.prev-file': [{ input: 'N' }],
    'diff-viewer.next-comment': [
      { input: 'c' },
      { flags: { rightArrow: true } },
    ],
    'diff-viewer.prev-comment': [
      { input: 'C' },
      { flags: { leftArrow: true } },
    ],
    'diff-viewer.delete-comment': [{ input: 'x' }],
    'diff-viewer.edit-comment': [{ input: 'e' }],
    'diff-viewer.post-comment': [{ input: 'p' }],
    'diff-viewer.editor-edit': [{ input: 'E' }],
    'diff-viewer.back': [{ flags: { escape: true } }],

    // Controls
    'controls.navigate-down': [{ input: 'j' }, { flags: { downArrow: true } }],
    'controls.navigate-up': [{ input: 'k' }, { flags: { upArrow: true } }],
    'controls.close': [{ flags: { escape: true } }],
    'controls.rebind': [{ flags: { return: true } }],
    'controls.cycle-left': [{ flags: { leftArrow: true } }],
    'controls.cycle-right': [{ flags: { rightArrow: true } }],
  },
};

export const PRESETS: KeybindPreset[] = [NORMIE_PRESET, VIM_PRESET];

export const DEFAULT_PRESET_ID = 'normie';

/** Get a preset by ID, falling back to the default */
export function getPreset(id: string | undefined): KeybindPreset {
  return PRESETS.find((p) => p.id === id) ?? NORMIE_PRESET;
}
