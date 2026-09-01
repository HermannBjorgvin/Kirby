import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as CoreModule from '@kirby/core';
import type * as WorktreeManagerModule from '@kirby/worktree-manager';
import type { PullRequestInfo } from '@kirby/vcs-core';
import {
  ACTIONS,
  NORMIE_PRESET,
  VIM_PRESET,
  resolveAction,
  type KeyPress,
  type SessionMenuState,
  type SidebarItem,
} from '@kirby/core';
import type { SessionMenuHandlerCtx } from './input-types.js';

// The session menu handler, driven through the real presets so a moved
// binding breaks these tests. Launching is mocked at the seam the
// handler uses (launchSession); the PTY registry is mocked so nothing
// spawns.

let liveSessions = new Set<string>();

vi.mock('@kirby/core', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  hasSession: (name: string) => liveSessions.has(name),
  launchSession: vi.fn(),
}));

vi.mock('@kirby/worktree-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof WorktreeManagerModule>()),
  listWorktrees: vi.fn(),
  createWorktree: vi.fn(),
}));

import { launchSession } from '@kirby/core';
import { createWorktree, listWorktrees } from '@kirby/worktree-manager';
import { handleSessionMenuInput } from './session-menu-input.js';

// ── Fixtures ─────────────────────────────────────────────────────

function makeKey(overrides: Partial<KeyPress> = {}): KeyPress {
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
    ...overrides,
  } as KeyPress;
}

const KEYS = {
  enter: () => ['', makeKey({ return: true })] as const,
  escape: () => ['', makeKey({ escape: true })] as const,
  down: () => ['', makeKey({ downArrow: true })] as const,
  up: () => ['', makeKey({ upArrow: true })] as const,
  left: () => ['', makeKey({ leftArrow: true })] as const,
  right: () => ['', makeKey({ rightArrow: true })] as const,
  char: (c: string) => [c, makeKey()] as const,
};

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 7,
    title: 'Add thing',
    sourceBranch: 'feat/thing',
    targetBranch: 'master',
    url: 'https://example.com/pr/7',
    createdByIdentifier: 'alice',
    createdByDisplayName: 'Alice',
    ...overrides,
  };
}

function sessionItem(name: string, pr?: PullRequestInfo): SidebarItem {
  return {
    kind: 'session',
    session: { name, running: false },
    ...(pr ? { pr } : {}),
  } as SidebarItem;
}

function makeCtx(opts: {
  menu: SessionMenuState;
  selectedItem?: SidebarItem;
  sessionName?: string | null;
  instruction?: string;
  preset?: typeof NORMIE_PRESET;
}) {
  const runCalls: Promise<void>[] = [];
  const state = { menu: opts.menu as SessionMenuState | null };
  const preset = opts.preset ?? NORMIE_PRESET;
  const pane = {
    get sessionMenu() {
      return state.menu;
    },
    setSessionMenu: vi.fn(
      (
        u:
          | SessionMenuState
          | null
          | ((p: SessionMenuState | null) => SessionMenuState | null)
      ) => {
        state.menu = typeof u === 'function' ? u(state.menu) : u;
      }
    ),
    reviewInstruction: opts.instruction ?? '',
    setReviewInstruction: vi.fn(),
    setPaneMode: vi.fn(),
    setReconnectKey: vi.fn(),
  };
  const nav = { focus: 'sidebar', setFocus: vi.fn() };
  const sessions = {
    flashStatus: vi.fn(),
    refreshSessions: vi.fn().mockResolvedValue([]),
  };
  const sidebar = { selectByKey: vi.fn() };
  const asyncOps = {
    run: vi.fn((_name: string, fn: () => Promise<void>) => {
      const done = fn();
      runCalls.push(done);
      return done;
    }),
    isRunning: vi.fn(() => false),
    inFlight: new Set<string>(),
  };
  const ctx = {
    pane,
    nav,
    asyncOps,
    sessions,
    sidebar,
    terminal: { paneCols: 80, paneRows: 24 },
    config: { config: { vendorAuth: {}, vendorProject: {} } },
    selectedItem: opts.selectedItem,
    sessionNameForTerminal:
      opts.sessionName === undefined ? 'alpha' : opts.sessionName,
    keybinds: {
      resolve: (input: string, key: KeyPress, context: 'confirm') =>
        resolveAction(input, key, context, preset.bindings, ACTIONS),
    },
  } as unknown as SessionMenuHandlerCtx;
  return {
    ctx,
    pane,
    nav,
    sessions,
    sidebar,
    asyncOps,
    state,
    settle: () => Promise.all(runCalls),
  };
}

function press(
  binding: readonly [string, KeyPress],
  ctx: SessionMenuHandlerCtx
) {
  handleSessionMenuInput(binding[0], binding[1], ctx);
}

const openMenu = (pr: PullRequestInfo | null = null): SessionMenuState => ({
  pr,
  selectedOption: 0,
  agentIndex: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  liveSessions = new Set();
});

// ── Agent picker ─────────────────────────────────────────────────

describe('session menu — agent picker', () => {
  it('cycles the agent with the arrows on the start row, wrapping', () => {
    const t = makeCtx({ menu: openMenu() });

    press(KEYS.right(), t.ctx);
    expect(t.state.menu?.agentIndex).toBe(1);
    press(KEYS.left(), t.ctx);
    press(KEYS.left(), t.ctx);
    // Five registry agents → wraps from the default to the last one.
    expect(t.state.menu?.agentIndex).toBe(4);
  });

  it('applies bunched arrow presses one step each (updater form)', () => {
    const t = makeCtx({ menu: openMenu() });

    press(KEYS.right(), t.ctx);
    press(KEYS.right(), t.ctx);
    expect(t.state.menu?.agentIndex).toBe(2);
  });

  it('does not cycle when another row is highlighted', () => {
    const t = makeCtx({ menu: { ...openMenu(makePr()), selectedOption: 1 } });

    press(KEYS.right(), t.ctx);
    expect(t.state.menu?.agentIndex).toBe(0);
  });
});

// ── Start ────────────────────────────────────────────────────────

describe('session menu — start', () => {
  it('launches the chosen agent in the row worktree and focuses it', async () => {
    const t = makeCtx({
      menu: { ...openMenu(), agentIndex: 1 },
      selectedItem: sessionItem('alpha'),
    });
    vi.mocked(listWorktrees).mockResolvedValue([
      { path: '/wt/alpha', branch: 'alpha', bare: false },
    ]);

    press(KEYS.enter(), t.ctx);
    await t.settle();

    expect(t.asyncOps.run.mock.calls[0]?.[0]).toBe('start-session');
    expect(launchSession).toHaveBeenCalledOnce();
    const params = vi.mocked(launchSession).mock.calls[0]![0];
    expect(params).toMatchObject({
      name: 'alpha',
      cols: 80,
      rows: 24,
      cwd: '/wt/alpha',
      request: { intent: 'continue-or-blank' },
    });
    // Index 1 is the first non-default registry agent.
    expect(params.agent?.id).toBe('codex');
    expect(t.sessions.refreshSessions).toHaveBeenCalledOnce();
    expect(t.sidebar.selectByKey).toHaveBeenCalledExactlyOnceWith(
      'session:alpha'
    );
    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(t.nav.setFocus).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(t.state.menu).toBeNull();
  });

  it('stays in the menu when no worktree can be resolved', async () => {
    const t = makeCtx({ menu: openMenu(), selectedItem: sessionItem('alpha') });
    vi.mocked(listWorktrees).mockResolvedValue([]);

    press(KEYS.enter(), t.ctx);
    await t.settle();

    expect(launchSession).not.toHaveBeenCalled();
    expect(t.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(
      'No worktree found for selected session'
    );
    expect(t.nav.setFocus).not.toHaveBeenCalled();
    expect(t.state.menu).not.toBeNull();
  });

  it('only focuses a session that is already running', async () => {
    liveSessions.add('alpha');
    const t = makeCtx({ menu: openMenu(), selectedItem: sessionItem('alpha') });

    press(KEYS.enter(), t.ctx);
    await t.settle();

    expect(launchSession).not.toHaveBeenCalled();
    expect(t.nav.setFocus).toHaveBeenCalledExactlyOnceWith('terminal');
  });
});

// ── Review ───────────────────────────────────────────────────────

describe('session menu — review', () => {
  it('seeds a review of the PR from the review row', async () => {
    const pr = makePr();
    const t = makeCtx({
      menu: { ...openMenu(pr), selectedOption: 1 },
      selectedItem: sessionItem('feat-thing', pr),
      sessionName: 'feat-thing',
    });
    vi.mocked(createWorktree).mockResolvedValue('/wt/feat-thing');

    press(KEYS.enter(), t.ctx);
    await t.settle();

    expect(createWorktree).toHaveBeenCalledExactlyOnceWith('feat/thing');
    expect(launchSession).toHaveBeenCalledOnce();
    const params = vi.mocked(launchSession).mock.calls[0]![0];
    expect(params.name).toBe('feat-thing');
    expect(params.cwd).toBe('/wt/feat-thing');
    expect(params.request.intent).toBe('continue-or-seed');
    expect(params.request.prompt).toContain('Review PR #7');
    expect(t.nav.setFocus).toHaveBeenCalledExactlyOnceWith('terminal');
  });

  it('types into the instruction buffer, including vim navigation keys', () => {
    const t = makeCtx({
      menu: { ...openMenu(makePr()), selectedOption: 2 },
      preset: VIM_PRESET,
    });

    press(KEYS.char('j'), t.ctx);

    expect(t.pane.setReviewInstruction).toHaveBeenCalledOnce();
    expect(t.state.menu?.selectedOption).toBe(2);
  });

  it('submits the instruction with the review on Enter', async () => {
    const pr = makePr();
    const t = makeCtx({
      menu: { ...openMenu(pr), selectedOption: 2 },
      selectedItem: sessionItem('feat-thing', pr),
      sessionName: 'feat-thing',
      instruction: 'focus on tests',
    });
    vi.mocked(createWorktree).mockResolvedValue('/wt/feat-thing');

    press(KEYS.enter(), t.ctx);
    await t.settle();

    const params = vi.mocked(launchSession).mock.calls[0]![0];
    expect(params.request.prompt).toContain('focus on tests');
  });
});

// ── Navigation and cancel ────────────────────────────────────────

describe('session menu — navigation', () => {
  it('clamps row movement to the rows the item has', () => {
    const t = makeCtx({ menu: openMenu() });

    press(KEYS.down(), t.ctx);
    press(KEYS.down(), t.ctx);
    // No PR → only start + cancel.
    expect(t.state.menu?.selectedOption).toBe(1);
    press(KEYS.up(), t.ctx);
    press(KEYS.up(), t.ctx);
    expect(t.state.menu?.selectedOption).toBe(0);
  });

  it('Esc closes a PR-less menu back to the terminal pane', () => {
    const t = makeCtx({ menu: openMenu() });

    press(KEYS.escape(), t.ctx);

    expect(t.state.menu).toBeNull();
    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('terminal');
  });

  it('Esc closes a PR menu back to the PR detail pane', () => {
    const t = makeCtx({ menu: openMenu(makePr()) });

    press(KEYS.escape(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('pr-detail');
    expect(t.pane.setReviewInstruction).toHaveBeenCalledExactlyOnceWith('');
  });

  it('Enter on the cancel row closes the menu', () => {
    const t = makeCtx({ menu: { ...openMenu(), selectedOption: 1 } });

    press(KEYS.enter(), t.ctx);

    expect(t.state.menu).toBeNull();
    expect(t.asyncOps.run).not.toHaveBeenCalled();
  });
});
