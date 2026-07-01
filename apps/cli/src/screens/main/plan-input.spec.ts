import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Key } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { ReviewComment } from '@kirby/review-comments';
import { handleDiffViewerInput } from './diff-viewer-input.js';
import { handleDiffFileListInput } from './diff-file-list-input.js';
import type {
  DiffViewerHandlerCtx,
  DiffFileListHandlerCtx,
} from './input-types.js';
import { ACTIONS, NORMIE_PRESET } from '../../keybindings/registry.js';
import { resolveAction } from '../../keybindings/resolver.js';
import {
  add,
  count,
  has,
  list,
  remove,
  toggle,
  annotate,
  clear,
  __resetPlanStoreForTest,
} from '../../plan/plan-store.js';

const PR_ID = 1;
const plan = {
  snapshot: new Map(),
  add,
  remove,
  has,
  toggle,
  annotate,
  list,
  count,
  clear,
};

function makeKey(overrides: Partial<Key> = {}): Key {
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
    ...overrides,
  };
}

const keybinds = {
  resolve: (
    input: string,
    key: Key,
    context: 'diff-viewer' | 'diff-file-list'
  ) => resolveAction(input, key, context, NORMIE_PRESET.bindings, ACTIONS),
} as unknown as DiffViewerHandlerCtx['keybinds'];

function localDraft(id = 'd1'): ReviewComment {
  return {
    id,
    file: 'a.ts',
    lineStart: 5,
    lineEnd: 5,
    severity: 'minor',
    body: 'draft body',
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2026-01-01',
  };
}

function remoteThread(id = 't1'): RemoteCommentThread {
  return {
    id,
    file: 'a.ts',
    lineStart: 8,
    lineEnd: 8,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: `${id}-root`,
        author: 'alice',
        body: 'root',
        createdAt: '2026-01-01',
      },
    ],
  };
}

// Minimal pane fake carrying only the fields the plan paths touch.
function makePane(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    paneMode: 'diff-file',
    priorPaneMode: 'terminal',
    diffViewFile: 'a.ts',
    selectedCommentId: null,
    editingCommentId: null,
    pendingDeleteCommentId: null,
    replyingToThreadId: null,
    diffScrollOffset: 0,
    diffFileIndex: 0,
    annotatingPlanKey: null,
    annotationBuffer: '',
    planCheckoutIndex: 0,
    planCheckoutTarget: null,
    showSkipped: false,
    ...initial,
  };
  return new Proxy(state, {
    get(t, prop: string) {
      if (prop.startsWith('set')) {
        const field = prop[3]!.toLowerCase() + prop.slice(4);
        return (v: unknown) => {
          t[field] =
            typeof v === 'function'
              ? (v as (p: unknown) => unknown)(t[field])
              : v;
        };
      }
      return t[prop];
    },
  }) as unknown as DiffViewerHandlerCtx['pane'];
}

function viewerCtx(pane: DiffViewerHandlerCtx['pane']): DiffViewerHandlerCtx {
  return {
    pane,
    diffFiles: [],
    terminal: { paneRows: 40, paneCols: 80 },
    diffTotalRows: 0,
    rowMap: { positions: [], totalRows: 0, sectionAnchorRows: [0] },
    sectionAnchorRows: [0],
    commentCtx: {
      comments: [localDraft()],
      prId: PR_ID,
      positions: new Map(),
      selectedReviewPr: { id: PR_ID } as never,
    },
    remoteCtx: {
      threads: [remoteThread()],
      replyToThread: vi.fn(),
      toggleResolved: vi.fn(),
      refresh: vi.fn(),
    },
    config: { config: {} } as never,
    sessions: { flashStatus: vi.fn() } as never,
    asyncOps: { run: vi.fn() } as never,
    keybinds,
    plan,
  } as unknown as DiffViewerHandlerCtx;
}

describe('diff-viewer plan actions', () => {
  beforeEach(() => __resetPlanStoreForTest());

  it('`a` toggles the selected local draft in the plan', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = viewerCtx(pane);
    handleDiffViewerInput('a', makeKey(), ctx);
    expect(has(PR_ID, 'local', 'd1')).toBe(true);
    handleDiffViewerInput('a', makeKey(), ctx);
    expect(has(PR_ID, 'local', 'd1')).toBe(false);
  });

  it('`a` toggles the selected remote thread in the plan', () => {
    const pane = makePane({ selectedCommentId: 't1' });
    handleDiffViewerInput('a', makeKey(), viewerCtx(pane));
    expect(has(PR_ID, 'remote', 't1')).toBe(true);
  });

  it('`Shift+A` adds the item and opens the note composer', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    handleDiffViewerInput('A', makeKey({ shift: true }), viewerCtx(pane));
    expect(has(PR_ID, 'local', 'd1')).toBe(true);
    expect((pane as unknown as Record<string, unknown>).annotatingPlanKey).toBe(
      'local:d1'
    );
  });

  it('`Shift+A` on an annotated item pre-fills the composer and keeps the note', () => {
    add(PR_ID, {
      kind: 'local',
      id: 'd1',
      file: 'a.ts',
      line: 5,
      body: 'b',
      severity: 'minor',
    });
    annotate(PR_ID, 'local', 'd1', 'existing note');
    const pane = makePane({ selectedCommentId: 'd1' });
    handleDiffViewerInput('A', makeKey({ shift: true }), viewerCtx(pane));
    const state = pane as unknown as Record<string, unknown>;
    expect(state.annotationBuffer).toBe('existing note');
    expect(list(PR_ID)[0]!.annotation).toBe('existing note');
  });

  it('annotation mode: typing then Enter stores the note', () => {
    add(PR_ID, {
      kind: 'local',
      id: 'd1',
      file: 'a.ts',
      line: 5,
      body: 'b',
      severity: 'minor',
    });
    const pane = makePane({
      selectedCommentId: 'd1',
      annotatingPlanKey: 'local:d1',
      annotationBuffer: '',
    });
    const ctx = viewerCtx(pane);
    handleDiffViewerInput('h', makeKey(), ctx);
    handleDiffViewerInput('i', makeKey(), ctx);
    handleDiffViewerInput('', makeKey({ return: true }), ctx);
    expect(list(PR_ID)[0]!.annotation).toBe('hi');
    expect(
      (pane as unknown as Record<string, unknown>).annotatingPlanKey
    ).toBeNull();
  });

  it('`c` opens the checkout pane when the plan is non-empty', () => {
    add(PR_ID, {
      kind: 'remote',
      id: 't1',
      file: 'a.ts',
      line: 8,
      body: 'root',
      author: 'alice',
      replies: [],
    });
    const pane = makePane({ selectedCommentId: 't1' });
    handleDiffViewerInput('c', makeKey(), viewerCtx(pane));
    expect((pane as unknown as Record<string, unknown>).paneMode).toBe(
      'plan-checkout'
    );
  });

  it('`c` flashes when the plan is empty (no pane switch)', () => {
    const pane = makePane({ selectedCommentId: 't1' });
    const ctx = viewerCtx(pane);
    handleDiffViewerInput('c', makeKey(), ctx);
    expect((pane as unknown as Record<string, unknown>).paneMode).toBe(
      'diff-file'
    );
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith('Plan is empty');
  });
});

function listCtx(pane: DiffFileListHandlerCtx['pane']): DiffFileListHandlerCtx {
  return {
    pane,
    diffFiles: [],
    diffDisplayCount: 1,
    fileCount: 0,
    shownGeneralComments: [remoteThread('g1')],
    keybinds,
    remoteCtx: { replyToThread: vi.fn(), toggleResolved: vi.fn() },
    sessions: { flashStatus: vi.fn() } as never,
    plan,
    prId: PR_ID,
  } as unknown as DiffFileListHandlerCtx;
}

describe('diff-file-list plan actions', () => {
  beforeEach(() => __resetPlanStoreForTest());

  it('`a` toggles the selected footer thread in the plan', () => {
    // diffFileIndex >= fileCount(0) selects footer comment 0.
    const pane = makePane({ diffFileIndex: 0 });
    handleDiffFileListInput('a', makeKey(), listCtx(pane));
    expect(has(PR_ID, 'remote', 'g1')).toBe(true);
  });
});
