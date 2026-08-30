import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as ReviewCommentsModule from '@kirby/review-comments';
import {
  readComments,
  updateComment,
  postReviewComments,
  type ReviewComment,
  type CommentPositionInfo,
  type RowMapEntry,
} from '@kirby/review-comments';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { DiffFile } from '@kirby/diff';
import {
  type SessionActionsContextValue,
  type PlanValue,
} from '@kirby/app-core';
import {
  ACTIONS,
  NORMIE_PRESET,
  resolveAction,
  type KeyPress,
} from '@kirby/core';
import { handleDiffViewerInput } from './diff-viewer-input.js';
import type { DiffViewerHandlerCtx } from './input-types.js';

// This suite covers handleDiffViewerInput's 22 action branches minus
// the three diff-viewer.plan-* actions, which already have dedicated
// coverage in ./plan-input.spec.ts (toggle/annotate/checkout against
// a real plan store) — duplicating them here would be tautological
// restating of that suite, not new characterization.
//
// Two branches are deliberately left untested: the inline-edit-mode
// and delete-confirm-mode key handling (lines ~129–166) are exempt
// from keybind resolution and sit *above* action dispatch, like reply
// mode — but only the reply-mode bypass was asked for, and the other
// two would mean re-deriving another shell's y/n and text-editing
// contract instead of pinning one of the 22 listed actions.

vi.mock('@kirby/review-comments', async (importOriginal) => {
  const actual = await importOriginal<typeof ReviewCommentsModule>();
  return {
    ...actual,
    readComments: vi.fn().mockReturnValue([]),
    updateComment: vi.fn(),
    removeComment: vi.fn(),
    postReviewComments: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../utils/editor-edit.js', () => ({
  openCommentInEditor: vi.fn().mockReturnValue('/tmp/kirby-comment-fake.md'),
}));

import { openCommentInEditor } from '../../utils/editor-edit.js';

// ── Test fixtures ────────────────────────────────────────────────

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
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

function makeFile(filename: string): DiffFile {
  return {
    filename,
    status: 'modified',
    additions: 1,
    deletions: 0,
    binary: false,
  };
}

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'd1',
    file: 'a.ts',
    lineStart: 5,
    lineEnd: 5,
    severity: 'minor',
    body: 'draft body',
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2026-01-01',
    ...overrides,
  };
}

function makeThread(
  id: string,
  overrides: Partial<RemoteCommentThread> = {}
): RemoteCommentThread {
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
    ...overrides,
  };
}

// Resolution runs against the real Normie preset, so these tests
// break if a binding moves — driving the handler through `resolve`
// rather than passing action IDs in is deliberate (see diff-file-list
// and plan-input specs, which follow the same approach).
const keybinds = {
  resolve: (input: string, key: KeyPress, context: 'diff-viewer') =>
    resolveAction(input, key, context, NORMIE_PRESET.bindings, ACTIONS),
} as unknown as DiffViewerHandlerCtx['keybinds'];

// Minimal mutable pane fake — every setter updates its own snapshot
// so tests can assert post-call state, matching the Proxy pattern in
// plan-input.spec.ts.
function makePane(
  initial: Record<string, unknown> = {}
): DiffViewerHandlerCtx['pane'] {
  const state: Record<string, unknown> = {
    paneMode: 'diff-file',
    diffViewFile: 'a.ts',
    diffFileIndex: 0,
    diffScrollOffset: 0,
    showSkipped: false,
    selectedCommentId: null,
    editingCommentId: null,
    editBuffer: '',
    pendingDeleteCommentId: null,
    replyingToThreadId: null,
    replyBuffer: '',
    annotatingPlanKey: null,
    annotationBuffer: '',
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

interface CtxOpts {
  files?: DiffFile[];
  paneRows?: number;
  diffTotalRows?: number;
  sectionAnchorRows?: number[];
  rowMapPositions?: RowMapEntry[];
  comments?: ReviewComment[];
  positions?: Map<string, CommentPositionInfo>;
  threads?: RemoteCommentThread[];
  prId?: number;
  headSha?: string;
  config?: Record<string, unknown>;
  asyncOpsRun?: (key: string, fn: () => Promise<void>) => void;
  toggleResolved?: (id: string, resolved: boolean) => Promise<boolean>;
  refresh?: () => void;
}

const PR_ID = 1;

function makeCtx(
  pane: DiffViewerHandlerCtx['pane'],
  opts: CtxOpts = {}
): DiffViewerHandlerCtx {
  const plan = {
    snapshot: new Map(),
    add: vi.fn(),
    remove: vi.fn(),
    has: vi.fn().mockReturnValue(false),
    toggle: vi.fn().mockReturnValue(true),
    annotate: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    count: vi.fn().mockReturnValue(0),
    clear: vi.fn(),
  } as unknown as PlanValue;

  return {
    pane,
    diffFiles: opts.files ?? [makeFile('a.ts'), makeFile('b.ts')],
    terminal: { paneRows: opts.paneRows ?? 23, paneCols: 80 },
    diffTotalRows: opts.diffTotalRows ?? 0,
    rowMap: {
      positions: opts.rowMapPositions ?? [],
      totalRows: 0,
      sectionAnchorRows: opts.sectionAnchorRows ?? [0],
    },
    sectionAnchorRows: opts.sectionAnchorRows ?? [0],
    commentCtx: makeCommentCtx(opts),
    remoteCtx: makeRemoteCtx(opts),
    config: { config: opts.config ?? {} } as never,
    sessions: { flashStatus: vi.fn() } as unknown as SessionActionsContextValue,
    asyncOps: { run: opts.asyncOpsRun ?? vi.fn() } as never,
    keybinds,
    plan,
  } as unknown as DiffViewerHandlerCtx;
}

/** Draft-comment half of the handler context. */
function makeCommentCtx(opts: CtxOpts) {
  return {
    comments: opts.comments ?? [],
    prId: opts.prId ?? PR_ID,
    positions: opts.positions ?? new Map(),
    selectedReviewPr: {
      id: opts.prId ?? PR_ID,
      headSha: opts.headSha,
    } as never,
  };
}

/** Reviewer-thread half of the handler context. */
function makeRemoteCtx(opts: CtxOpts) {
  return {
    threads: opts.threads ?? [],
    replyToThread: vi.fn(),
    toggleResolved: opts.toggleResolved ?? vi.fn().mockResolvedValue(true),
    refresh: opts.refresh ?? vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readComments).mockReturnValue([]);
  vi.mocked(postReviewComments).mockResolvedValue(undefined);
});

// ── back ────────────────────────────────────────────────────────

describe('diff-viewer handler — back', () => {
  it('returns to the file list and clears the open file', () => {
    const pane = makePane({ paneMode: 'diff-file', diffViewFile: 'a.ts' });
    const ctx = makeCtx(pane);
    handleDiffViewerInput('', makeKey({ escape: true }), ctx);
    expect(pane.paneMode).toBe('diff');
    expect(pane.diffViewFile).toBeNull();
  });
});

// ── scroll-down / scroll-up ────────────────────────────────────────
// viewportHeight = paneRows(23) - 3 = 20; diffTotalRows(25) → maxScroll = 5

describe('diff-viewer handler — scroll-down / scroll-up', () => {
  it('scroll-down increments the offset by one', () => {
    const pane = makePane({ diffScrollOffset: 2 });
    const ctx = makeCtx(pane, { diffTotalRows: 25 });
    handleDiffViewerInput('', makeKey({ downArrow: true }), ctx);
    expect(pane.diffScrollOffset).toBe(3);
  });

  it('scroll-down clamps at maxScroll', () => {
    const pane = makePane({ diffScrollOffset: 5 });
    const ctx = makeCtx(pane, { diffTotalRows: 25 });
    handleDiffViewerInput('', makeKey({ downArrow: true }), ctx);
    expect(pane.diffScrollOffset).toBe(5);
  });

  it('scroll-up decrements the offset by one', () => {
    const pane = makePane({ diffScrollOffset: 3 });
    const ctx = makeCtx(pane, { diffTotalRows: 25 });
    handleDiffViewerInput('', makeKey({ upArrow: true }), ctx);
    expect(pane.diffScrollOffset).toBe(2);
  });

  it('scroll-up clamps at zero', () => {
    const pane = makePane({ diffScrollOffset: 0 });
    const ctx = makeCtx(pane, { diffTotalRows: 25 });
    handleDiffViewerInput('', makeKey({ upArrow: true }), ctx);
    expect(pane.diffScrollOffset).toBe(0);
  });
});

// ── half-page-down / half-page-up ─────────────────────────────────
// viewportHeight = 20, half = 10; diffTotalRows(100) → maxScroll = 80

describe('diff-viewer handler — half-page-down / half-page-up', () => {
  it('half-page-down advances by half the viewport', () => {
    const pane = makePane({ diffScrollOffset: 0 });
    const ctx = makeCtx(pane, { diffTotalRows: 100 });
    handleDiffViewerInput('', makeKey({ pageDown: true }), ctx);
    expect(pane.diffScrollOffset).toBe(10);
  });

  it('half-page-down clamps at maxScroll', () => {
    const pane = makePane({ diffScrollOffset: 75 });
    const ctx = makeCtx(pane, { diffTotalRows: 100 });
    handleDiffViewerInput('', makeKey({ pageDown: true }), ctx);
    expect(pane.diffScrollOffset).toBe(80);
  });

  it('half-page-up retreats by half the viewport', () => {
    const pane = makePane({ diffScrollOffset: 50 });
    const ctx = makeCtx(pane, { diffTotalRows: 100 });
    handleDiffViewerInput('', makeKey({ pageUp: true }), ctx);
    expect(pane.diffScrollOffset).toBe(40);
  });

  it('half-page-up clamps at zero', () => {
    const pane = makePane({ diffScrollOffset: 5 });
    const ctx = makeCtx(pane, { diffTotalRows: 100 });
    handleDiffViewerInput('', makeKey({ pageUp: true }), ctx);
    expect(pane.diffScrollOffset).toBe(0);
  });
});

// ── go-top / go-bottom ─────────────────────────────────────────────

describe('diff-viewer handler — go-top / go-bottom', () => {
  it('go-top jumps to zero from anywhere', () => {
    const pane = makePane({ diffScrollOffset: 42 });
    const ctx = makeCtx(pane, { diffTotalRows: 100 });
    handleDiffViewerInput('', makeKey({ home: true }), ctx);
    expect(pane.diffScrollOffset).toBe(0);
  });

  it('go-bottom jumps to maxScroll', () => {
    const pane = makePane({ diffScrollOffset: 0 });
    const ctx = makeCtx(pane, { diffTotalRows: 100 }); // maxScroll = 80
    handleDiffViewerInput('', makeKey({ end: true }), ctx);
    expect(pane.diffScrollOffset).toBe(80);
  });

  it('go-bottom lands on zero when the diff fits in one viewport', () => {
    const pane = makePane({ diffScrollOffset: 0 });
    const ctx = makeCtx(pane, { diffTotalRows: 5 }); // maxScroll = 0
    handleDiffViewerInput('', makeKey({ end: true }), ctx);
    expect(pane.diffScrollOffset).toBe(0);
  });
});

// ── next-section / prev-section ───────────────────────────────────
// diffTotalRows(100) → maxScroll = 80

describe('diff-viewer handler — next-section / prev-section', () => {
  it('next-section jumps to the first anchor past the current offset', () => {
    const pane = makePane({ diffScrollOffset: 10 });
    const ctx = makeCtx(pane, {
      diffTotalRows: 100,
      sectionAnchorRows: [0, 15, 40],
    });
    handleDiffViewerInput('', makeKey({ downArrow: true, ctrl: true }), ctx);
    expect(pane.diffScrollOffset).toBe(15);
  });

  it('next-section is a no-op past the last anchor', () => {
    const pane = makePane({ diffScrollOffset: 50 });
    const ctx = makeCtx(pane, {
      diffTotalRows: 100,
      sectionAnchorRows: [0, 15, 40],
    });
    handleDiffViewerInput('', makeKey({ downArrow: true, ctrl: true }), ctx);
    expect(pane.diffScrollOffset).toBe(50);
  });

  it('next-section clamps the target anchor to maxScroll', () => {
    const pane = makePane({ diffScrollOffset: 10 });
    const ctx = makeCtx(pane, {
      diffTotalRows: 100,
      sectionAnchorRows: [0, 95],
    });
    handleDiffViewerInput('', makeKey({ downArrow: true, ctrl: true }), ctx);
    expect(pane.diffScrollOffset).toBe(80);
  });

  it('prev-section jumps to the nearest anchor below the current offset', () => {
    const pane = makePane({ diffScrollOffset: 50 });
    const ctx = makeCtx(pane, {
      diffTotalRows: 100,
      sectionAnchorRows: [10, 15, 40],
    });
    handleDiffViewerInput('', makeKey({ upArrow: true, ctrl: true }), ctx);
    expect(pane.diffScrollOffset).toBe(40);
  });

  // Asymmetric with next-section: with nothing before it, next-section
  // is a no-op (stays put) but prev-section actively resets to zero.
  it('prev-section defaults to zero when no anchor precedes the offset', () => {
    const pane = makePane({ diffScrollOffset: 5 });
    const ctx = makeCtx(pane, {
      diffTotalRows: 100,
      sectionAnchorRows: [10, 15, 40],
    });
    handleDiffViewerInput('', makeKey({ upArrow: true, ctrl: true }), ctx);
    expect(pane.diffScrollOffset).toBe(0);
  });
});

// ── next-file / prev-file ─────────────────────────────────────────

describe('diff-viewer handler — next-file / prev-file', () => {
  it('next-file advances to the following file and resets scroll', () => {
    const pane = makePane({
      diffViewFile: 'a.ts',
      diffFileIndex: 0,
      diffScrollOffset: 7,
    });
    const files = [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts')];
    const ctx = makeCtx(pane, { files });
    handleDiffViewerInput('', makeKey({ rightArrow: true }), ctx);
    expect(pane.diffViewFile).toBe('b.ts');
    expect(pane.diffFileIndex).toBe(1);
    expect(pane.diffScrollOffset).toBe(0);
  });

  it('next-file is a no-op on the last file', () => {
    const pane = makePane({
      diffViewFile: 'c.ts',
      diffFileIndex: 2,
      diffScrollOffset: 9,
    });
    const files = [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts')];
    const ctx = makeCtx(pane, { files });
    handleDiffViewerInput('', makeKey({ rightArrow: true }), ctx);
    expect(pane.diffViewFile).toBe('c.ts');
    expect(pane.diffScrollOffset).toBe(9);
  });

  it('prev-file retreats to the preceding file and resets scroll', () => {
    const pane = makePane({
      diffViewFile: 'b.ts',
      diffFileIndex: 1,
      diffScrollOffset: 7,
    });
    const files = [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts')];
    const ctx = makeCtx(pane, { files });
    handleDiffViewerInput('', makeKey({ leftArrow: true }), ctx);
    expect(pane.diffViewFile).toBe('a.ts');
    expect(pane.diffFileIndex).toBe(0);
    expect(pane.diffScrollOffset).toBe(0);
  });

  it('prev-file is a no-op on the first file', () => {
    const pane = makePane({
      diffViewFile: 'a.ts',
      diffFileIndex: 0,
      diffScrollOffset: 9,
    });
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const ctx = makeCtx(pane, { files });
    handleDiffViewerInput('', makeKey({ leftArrow: true }), ctx);
    expect(pane.diffViewFile).toBe('a.ts');
    expect(pane.diffScrollOffset).toBe(9);
  });
});

// ── next-comment / prev-comment ───────────────────────────────────

describe('diff-viewer handler — next-comment / prev-comment', () => {
  it('selects the first pool entry when nothing is selected', () => {
    const pane = makePane({ selectedCommentId: null });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', lineStart: 5 })],
      threads: [makeThread('t1', { lineStart: 10 })],
    });
    handleDiffViewerInput('', makeKey({ downArrow: true, shift: true }), ctx);
    expect(pane.selectedCommentId).toBe('d1');
  });

  it('next-comment wraps from the last entry to the first', () => {
    const pane = makePane({ selectedCommentId: 't1' });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', lineStart: 5 })],
      threads: [makeThread('t1', { lineStart: 10 })],
    });
    handleDiffViewerInput('', makeKey({ downArrow: true, shift: true }), ctx);
    expect(pane.selectedCommentId).toBe('d1');
  });

  it('prev-comment wraps from the first entry to the last', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', lineStart: 5 })],
      threads: [makeThread('t1', { lineStart: 10 })],
    });
    handleDiffViewerInput('', makeKey({ upArrow: true, shift: true }), ctx);
    expect(pane.selectedCommentId).toBe('t1');
  });

  it('is a no-op when the pool is empty', () => {
    const pane = makePane({ selectedCommentId: null });
    const ctx = makeCtx(pane, { comments: [], threads: [] });
    handleDiffViewerInput('', makeKey({ downArrow: true, shift: true }), ctx);
    expect(pane.selectedCommentId).toBeNull();
  });

  // Regression: posted local comments render via the remote-thread
  // path (interleaveComments), so they must never be reachable
  // through next/prev-comment — a dropped filter here re-selects an
  // invisible local entry.
  it('filters out posted local comments from navigation', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, {
      comments: [
        makeComment({ id: 'd1', lineStart: 1, status: 'draft' }),
        makeComment({ id: 'd2', lineStart: 2, status: 'posted' }),
        makeComment({ id: 'd3', lineStart: 3, status: 'draft' }),
      ],
      threads: [],
    });
    handleDiffViewerInput('', makeKey({ downArrow: true, shift: true }), ctx);
    expect(pane.selectedCommentId).toBe('d3');
  });

  it('selecting a comment scrolls it into view via the row map', () => {
    const pane = makePane({ selectedCommentId: null, diffScrollOffset: 0 });
    const positions = new Map<string, CommentPositionInfo>([
      ['d1', { headerLine: 0, refStartLine: 2 }],
    ]);
    const rowMapPositions: RowMapEntry[] = [
      { rowStart: 0, rowSpan: 1 },
      { rowStart: 1, rowSpan: 1 },
      { rowStart: 12, rowSpan: 1 }, // refStartLine 2
    ];
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', lineStart: 5 })],
      threads: [],
      positions,
      rowMapPositions,
      diffTotalRows: 100, // maxScroll = 80
    });
    handleDiffViewerInput('', makeKey({ downArrow: true, shift: true }), ctx);
    expect(pane.selectedCommentId).toBe('d1');
    expect(pane.diffScrollOffset).toBe(10); // rowStart(12) - 2
  });

  it('clamps the scroll-to-comment target to maxScroll', () => {
    const pane = makePane({ selectedCommentId: null, diffScrollOffset: 0 });
    const positions = new Map<string, CommentPositionInfo>([
      ['d1', { headerLine: 0, refStartLine: 0 }],
    ]);
    const rowMapPositions: RowMapEntry[] = [{ rowStart: 95, rowSpan: 1 }];
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', lineStart: 5 })],
      threads: [],
      positions,
      rowMapPositions,
      diffTotalRows: 100, // maxScroll = 80
    });
    handleDiffViewerInput('', makeKey({ downArrow: true, shift: true }), ctx);
    expect(pane.diffScrollOffset).toBe(80); // 95 - 2 = 93, clamped to 80
  });
});

// ── delete-comment ─────────────────────────────────────────────────

describe('diff-viewer handler — delete-comment', () => {
  it('arms the confirm prompt for the selected local draft', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, { comments: [makeComment({ id: 'd1' })] });
    handleDiffViewerInput('', makeKey({ delete: true }), ctx);
    expect(pane.pendingDeleteCommentId).toBe('d1');
  });

  // Without this guard, pressing Delete while a remote thread is
  // selected enters an invisible delete-confirm trap — remote threads
  // render no y/n prompt.
  it('is a no-op when the selection is a remote thread', () => {
    const pane = makePane({ selectedCommentId: 't1' });
    const ctx = makeCtx(pane, { comments: [], threads: [makeThread('t1')] });
    handleDiffViewerInput('', makeKey({ delete: true }), ctx);
    expect(pane.pendingDeleteCommentId).toBeNull();
  });
});

// ── edit-comment ────────────────────────────────────────────────────

describe('diff-viewer handler — edit-comment', () => {
  it('loads the selected draft into the edit buffer', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', body: 'fix this' })],
    });
    handleDiffViewerInput('e', makeKey(), ctx);
    expect(pane.editingCommentId).toBe('d1');
    expect(pane.editBuffer).toBe('fix this');
  });

  it('is a no-op when the selection is a remote thread', () => {
    const pane = makePane({ selectedCommentId: 't1' });
    const ctx = makeCtx(pane, { comments: [], threads: [makeThread('t1')] });
    handleDiffViewerInput('e', makeKey(), ctx);
    expect(pane.editingCommentId).toBeNull();
  });
});

// ── post-comment ────────────────────────────────────────────────────

describe('diff-viewer handler — post-comment', () => {
  it('does nothing when the selected comment is not a draft', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const run = vi.fn();
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', status: 'posting' })],
      config: { vendor: 'github' },
      headSha: 'sha1',
      asyncOpsRun: run,
    });
    handleDiffViewerInput('p', makeKey(), ctx);
    expect(run).not.toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it('flashes when no vendor is configured', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', status: 'draft' })],
      config: {},
    });
    handleDiffViewerInput('p', makeKey(), ctx);
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith('No VCS configured');
    expect(updateComment).not.toHaveBeenCalled();
  });

  it('flashes for an unsupported vendor', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', status: 'draft' })],
      config: { vendor: 'gitlab' },
    });
    handleDiffViewerInput('p', makeKey(), ctx);
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith(
      'Unsupported vendor: gitlab'
    );
  });

  it('flashes when a github PR is missing its head SHA', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', status: 'draft' })],
      config: { vendor: 'github' },
      headSha: undefined,
    });
    handleDiffViewerInput('p', makeKey(), ctx);
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith(
      'Missing head SHA — try refreshing PR data'
    );
  });

  it('marks the comment posting and hands off to asyncOps.run', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const run = vi.fn();
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', status: 'draft' })],
      config: { vendor: 'github' },
      headSha: 'sha1',
      prId: 7,
      asyncOpsRun: run,
    });
    handleDiffViewerInput('p', makeKey(), ctx);
    expect(updateComment).toHaveBeenCalledWith(7, 'd1', { status: 'posting' });
    expect(run).toHaveBeenCalledWith('post-comment', expect.any(Function));
  });

  it('on success, refreshes remote threads and selects the next draft', async () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const d1 = makeComment({ id: 'd1', status: 'draft', lineStart: 1 });
    const d2 = makeComment({ id: 'd2', status: 'draft', lineStart: 2 });
    vi.mocked(readComments).mockReturnValue([{ ...d1, status: 'posted' }, d2]);
    const refresh = vi.fn();
    let captured: (() => Promise<void>) | undefined;
    const run = vi.fn((_key: string, fn: () => Promise<void>) => {
      captured = fn;
    });
    const ctx = makeCtx(pane, {
      comments: [d1, d2],
      config: { vendor: 'github' },
      headSha: 'sha1',
      prId: 7,
      asyncOpsRun: run,
      refresh,
    });
    handleDiffViewerInput('p', makeKey(), ctx);
    await captured!();
    expect(postReviewComments).toHaveBeenCalledWith(
      [d1],
      expect.objectContaining({ vendor: 'github', prId: 7, headSha: 'sha1' })
    );
    expect(refresh).toHaveBeenCalled();
    expect(pane.selectedCommentId).toBe('d2');
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith('Comment posted');
  });

  it('on failure, reverts the comment to draft and flashes the error', async () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    vi.mocked(postReviewComments).mockRejectedValue(new Error('network down'));
    let captured: (() => Promise<void>) | undefined;
    const run = vi.fn((_key: string, fn: () => Promise<void>) => {
      captured = fn;
    });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', status: 'draft' })],
      config: { vendor: 'github' },
      headSha: 'sha1',
      prId: 7,
      asyncOpsRun: run,
    });
    handleDiffViewerInput('p', makeKey(), ctx);
    await captured!();
    expect(updateComment).toHaveBeenCalledWith(7, 'd1', { status: 'draft' });
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith(
      'Post failed: network down'
    );
  });
});

// ── editor-edit ─────────────────────────────────────────────────────

describe('diff-viewer handler — editor-edit', () => {
  // The 'no editor configured' guard falls back to process.env.EDITOR
  // / VISUAL — strip both so a developer's real shell environment
  // can't make this test pass or fail by accident.
  const savedEditor = process.env.EDITOR;
  const savedVisual = process.env.VISUAL;

  beforeEach(() => {
    delete process.env.EDITOR;
    delete process.env.VISUAL;
  });

  afterEach(() => {
    if (savedEditor === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = savedEditor;
    if (savedVisual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = savedVisual;
  });

  it('is a no-op when the selection is not a local draft', () => {
    const pane = makePane({ selectedCommentId: 't1' });
    const ctx = makeCtx(pane, {
      comments: [],
      threads: [makeThread('t1')],
      config: { editor: 'vim' },
    });
    handleDiffViewerInput('E', makeKey({ shift: true }), ctx);
    expect(openCommentInEditor).not.toHaveBeenCalled();
  });

  it('flashes when no editor is configured', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1' })],
      config: {},
    });
    handleDiffViewerInput('E', makeKey({ shift: true }), ctx);
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith(
      'No editor configured — set one in settings'
    );
    expect(openCommentInEditor).not.toHaveBeenCalled();
  });

  it('opens the configured editor for the selected draft', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1', body: 'fix this' })],
      config: { editor: 'vim' },
      prId: 3,
    });
    handleDiffViewerInput('E', makeKey({ shift: true }), ctx);
    expect(openCommentInEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: 'd1',
        initialBody: 'fix this',
        editor: 'vim',
      })
    );
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith(
      'Opened comment in vim'
    );
  });
});

// ── reply-to-thread ─────────────────────────────────────────────────

describe('diff-viewer handler — reply-to-thread', () => {
  it('enters reply mode for the selected remote thread', () => {
    const pane = makePane({ selectedCommentId: 't1' });
    const ctx = makeCtx(pane, { comments: [], threads: [makeThread('t1')] });
    handleDiffViewerInput('r', makeKey(), ctx);
    expect(pane.replyingToThreadId).toBe('t1');
    expect(pane.replyBuffer).toBe('');
  });

  it('is a no-op when the selection is a local draft', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const ctx = makeCtx(pane, { comments: [makeComment({ id: 'd1' })] });
    handleDiffViewerInput('r', makeKey(), ctx);
    expect(pane.replyingToThreadId).toBeNull();
  });
});

// ── toggle-thread-resolved ───────────────────────────────────────────

describe('diff-viewer handler — toggle-thread-resolved', () => {
  it('resolves an unresolved thread', async () => {
    const pane = makePane({ selectedCommentId: 't1' });
    const toggleResolved = vi.fn().mockResolvedValue(true);
    const ctx = makeCtx(pane, {
      comments: [],
      threads: [makeThread('t1', { isResolved: false })],
      toggleResolved,
    });
    handleDiffViewerInput('v', makeKey(), ctx);
    expect(toggleResolved).toHaveBeenCalledWith('t1', true);
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith(
      'Resolving thread...'
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith('Thread resolved');
  });

  it('reopens a resolved thread', async () => {
    const pane = makePane({ selectedCommentId: 't1' });
    const toggleResolved = vi.fn().mockResolvedValue(true);
    const ctx = makeCtx(pane, {
      comments: [],
      threads: [makeThread('t1', { isResolved: true })],
      toggleResolved,
    });
    handleDiffViewerInput('v', makeKey(), ctx);
    expect(toggleResolved).toHaveBeenCalledWith('t1', false);
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith('Thread reopened');
  });

  it('flashes the error on failure', async () => {
    const pane = makePane({ selectedCommentId: 't1' });
    const toggleResolved = vi.fn().mockRejectedValue(new Error('boom'));
    const ctx = makeCtx(pane, {
      comments: [],
      threads: [makeThread('t1', { isResolved: false })],
      toggleResolved,
    });
    handleDiffViewerInput('v', makeKey(), ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.sessions.flashStatus).toHaveBeenCalledWith('Failed: boom');
  });

  it('is a no-op when the selection is a local draft', () => {
    const pane = makePane({ selectedCommentId: 'd1' });
    const toggleResolved = vi.fn();
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1' })],
      toggleResolved,
    });
    handleDiffViewerInput('v', makeKey(), ctx);
    expect(toggleResolved).not.toHaveBeenCalled();
  });
});

// ── reply-mode bypass ─────────────────────────────────────────────
// handleReplyModeInput runs before the keybind resolver — see line
// ~111 in diff-viewer-input.ts. reply-mode.spec.ts already covers its
// internal Esc/Enter/text-append contract; these two tests only pin
// that the diff-viewer wires the bypass in *before* any of the 22
// actions can dispatch.

describe('diff-viewer handler — reply-mode bypass', () => {
  it('swallows a bound key as text input instead of firing its action', () => {
    const pane = makePane({
      replyingToThreadId: 't1',
      replyBuffer: '',
      selectedCommentId: 'd1',
    });
    // 'e' is bound to edit-comment; while replying it must be
    // swallowed by the reply buffer, never opening the inline editor.
    const ctx = makeCtx(pane, {
      comments: [makeComment({ id: 'd1' })],
      threads: [makeThread('t1')],
    });
    handleDiffViewerInput('e', makeKey(), ctx);
    expect(pane.replyBuffer).toBe('e');
    expect(pane.editingCommentId).toBeNull();
  });

  it('Esc exits reply mode without firing diff-viewer.back', () => {
    const pane = makePane({
      replyingToThreadId: 't1',
      replyBuffer: 'draft',
      paneMode: 'diff-file',
      diffViewFile: 'a.ts',
    });
    const ctx = makeCtx(pane, { comments: [], threads: [makeThread('t1')] });
    handleDiffViewerInput('', makeKey({ escape: true }), ctx);
    expect(pane.replyingToThreadId).toBeNull();
    // `back` (also bound to Esc) would have cleared these — proving
    // dispatch never ran.
    expect(pane.paneMode).toBe('diff-file');
    expect(pane.diffViewFile).toBe('a.ts');
  });
});
