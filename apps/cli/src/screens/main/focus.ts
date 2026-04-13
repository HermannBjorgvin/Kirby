// Pure helpers that decide which pane (sidebar or main) is visually
// "focused" and what title the main pane should display. Extracted from
// MainTab.tsx so the rules live in one place, are easy to unit-test, and
// can't silently drift out of sync with input-handler behavior.
//
// The rules stay in sync with two things:
//   1. The actual input sink — whichever handler's useInput fires.
//   2. The auto-hide sidebar feature (commit 06bd627), which only hides
//      the sidebar when nav.focus === 'terminal'. Our helpers must agree
//      that the sidebar is NOT focused in those cases.

import type { Focus, PaneMode } from '../../types.js';
import { resolvePresetName } from '../../utils/resolve-preset-name.js';
import { AI_PRESETS } from '../../components/SettingsPanel.js';

export interface FocusState {
  navFocus: Focus;
  paneMode: PaneMode;
  branchPickerCreating: boolean;
  settingsOpen: boolean;
  reviewConfirmActive: boolean;
  deleteConfirmActive: boolean;
}

/**
 * Returns true when the main content pane should render with the active
 * border color. Precedence (highest first):
 *   1. Delete confirm modal → NEITHER pane is focused (modal owns focus).
 *   2. Any modal-ish state (branch picker, settings, review confirm) →
 *      main pane, because that's where the modal content renders.
 *   3. Diff modes → main pane, because DiffPane's useInput is the sink.
 *   4. Otherwise → whichever side nav.focus points at.
 */
export function getMainFocused(s: FocusState): boolean {
  if (s.deleteConfirmActive) return false;
  if (s.branchPickerCreating) return true;
  if (s.settingsOpen) return true;
  if (s.reviewConfirmActive) return true;
  if (s.paneMode === 'diff' || s.paneMode === 'diff-file') return true;
  return s.navFocus === 'terminal';
}

/**
 * Returns true when the sidebar should render with the active border color.
 * When a delete confirm modal is open, neither pane is focused — the modal
 * has keyboard focus exclusively.
 */
export function getSidebarFocused(s: FocusState): boolean {
  if (s.deleteConfirmActive) return false;
  return !getMainFocused(s);
}

export interface PaneTitleState {
  paneMode: PaneMode;
  branchPickerCreating: boolean;
  settingsOpen: boolean;
  controlsOpen: boolean;
  reviewConfirmActive: boolean;
  aiCommand: string | undefined;
  prTitle: string | undefined;
  sessionName: string | null;
}

/**
 * Human-readable title for the main pane. Precedence matches the render
 * precedence in MainTab / MainContent.
 *
 * In terminal mode the title becomes:
 *   🤖 Claude — Fix navigation bug   (PR title available)
 *   🤖 Claude — feature-foo          (no PR, falls back to session/branch name)
 *   🤖 Claude                        (no session selected)
 */
export function getPaneTitle(s: PaneTitleState): string {
  if (s.controlsOpen) return 'Controls';
  if (s.settingsOpen) return 'Settings';
  if (s.branchPickerCreating) return 'New Session';
  if (s.reviewConfirmActive) return 'Confirm Review';
  if (s.paneMode === 'pr-detail') return 'Pull Request';
  if (s.paneMode === 'diff' || s.paneMode === 'diff-file')
    return 'Files Changed';

  const agent = resolvePresetName(s.aiCommand, AI_PRESETS, 'Agent');
  const label = s.prTitle || s.sessionName;
  if (label) return `\u{1F916} ${agent} \u2014 ${label}`;
  return `\u{1F916} ${agent}`;
}
