import { describe, it, expect, vi } from 'vitest';
import type { Key } from 'ink';
import { handleSidebarInput } from './sidebar-input.js';
import type { SidebarInputCtx } from './input-types.js';
import type { SidebarItem } from '../../types.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeKey(): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    tab: false,
    backspace: false,
    delete: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    ctrl: false,
    shift: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  };
}

function sessionItem(name: string, running = true): SidebarItem {
  return {
    kind: 'session',
    session: { name, running },
    isMerged: false,
  };
}

function buildCtx(items: SidebarItem[], action: string | null) {
  const sidebar = {
    items,
    selectedIndex: 0,
    selectedItem: items[0],
    selectedPr: undefined,
    sessionNameForTerminal: null,
    totalItems: items.length,
    selectByKey: vi.fn(),
    moveSelection: vi.fn(),
    moveSelectionToActive: vi.fn(),
  };
  const pane = {
    setPaneMode: vi.fn(),
    setReconnectKey: vi.fn(),
  };
  const nav = {
    focus: 'sidebar' as const,
    setFocus: vi.fn(),
  };
  const ctx = {
    sidebar,
    pane,
    nav,
    keybinds: {
      resolve: vi.fn(() => action),
    },
    toggleHints: vi.fn(),
    exit: vi.fn(),
    // Unused fields below — cast via SidebarInputCtx forces the rest
    // to be present at the type level, but the dispatch never reads
    // them when the action is `sidebar.switch-tab-*`.
    config: {} as never,
    sessions: {} as never,
    branchPicker: {} as never,
    deleteConfirm: {} as never,
    settings: {} as never,
    asyncOps: {} as never,
    terminal: {} as never,
  } as unknown as SidebarInputCtx;

  return { ctx, sidebar, pane, nav };
}

// ── Tests ────────────────────────────────────────────────────────

describe('handleSidebarInput — sidebar.switch-tab-N', () => {
  it('selects the Nth running session and jumps focus to terminal', () => {
    const items: SidebarItem[] = [
      sessionItem('alpha', true),
      sessionItem('beta', false), // not running — skipped
      sessionItem('gamma', true),
      sessionItem('delta', true),
    ];
    const { ctx, sidebar, pane, nav } = buildCtx(items, 'sidebar.switch-tab-2');

    handleSidebarInput('2', makeKey(), ctx);

    // 1st running = alpha, 2nd running = gamma → switch-tab-2 selects gamma
    expect(sidebar.selectByKey).toHaveBeenCalledExactlyOnceWith(
      'session:gamma'
    );
    expect(pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(pane.setReconnectKey).toHaveBeenCalledOnce();
    expect(nav.setFocus).toHaveBeenCalledExactlyOnceWith('terminal');
  });

  it('treats 0 as tab 10', () => {
    const items: SidebarItem[] = Array.from({ length: 12 }, (_, i) =>
      sessionItem(`s${i + 1}`, true)
    );
    const { ctx, sidebar } = buildCtx(items, 'sidebar.switch-tab-10');

    handleSidebarInput('0', makeKey(), ctx);

    expect(sidebar.selectByKey).toHaveBeenCalledExactlyOnceWith('session:s10');
  });

  it('does nothing when the requested tab index has no running session', () => {
    const items: SidebarItem[] = [
      sessionItem('alpha', true),
      sessionItem('beta', true),
    ];
    const { ctx, sidebar, pane, nav } = buildCtx(items, 'sidebar.switch-tab-5');

    handleSidebarInput('5', makeKey(), ctx);

    expect(sidebar.selectByKey).not.toHaveBeenCalled();
    expect(pane.setPaneMode).not.toHaveBeenCalled();
    expect(nav.setFocus).not.toHaveBeenCalled();
  });

  it('skips orphan-pr / review-pr rows when counting tabs', () => {
    const items: SidebarItem[] = [
      {
        kind: 'orphan-pr',
        pr: {
          id: 1,
          title: 'orphan',
          sourceBranch: 'o',
          targetBranch: 'master',
          url: '',
          createdByIdentifier: '',
          createdByDisplayName: '',
        },
      },
      sessionItem('alpha', true),
      sessionItem('beta', true),
    ];
    const { ctx, sidebar } = buildCtx(items, 'sidebar.switch-tab-1');

    handleSidebarInput('1', makeKey(), ctx);

    expect(sidebar.selectByKey).toHaveBeenCalledExactlyOnceWith(
      'session:alpha'
    );
  });
});
