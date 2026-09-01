import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  PaneModeValue,
  PlanValue,
  SessionActionsContextValue,
} from '@kirby/app-core';
import type { KeyPress } from '@kirby/core';
import {
  ACTIONS,
  NORMIE_PRESET,
  planItemKey,
  resolveAction,
} from '@kirby/core';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { DiffFile } from '@kirby/diff';
import { handleDiffFileListInput } from './diff-file-list-input.js';
import type { DiffFileListHandlerCtx } from './input-types.js';

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

function makeThread(id: string, body = 'hi'): RemoteCommentThread {
  return {
    id,
    file: null,
    lineStart: null,
    lineEnd: null,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: `${id}-root`,
        author: 'user',
        body,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

// Minimal mutable pane stub — every setter updates its own snapshot
// so tests can assert post-call state.
function makePane(initial: Partial<PaneModeValue> = {}): PaneModeValue {
  const state: Record<string, unknown> = {
    paneMode: 'diff',
    diffFileIndex: 0,
    diffViewFile: null,
    diffScrollOffset: 0,
    diffListScrollRow: 0,
    showSkipped: false,
    selectedCommentId: null,
    pendingDeleteCommentId: null,
    editingCommentId: null,
    editBuffer: '',
    replyingToThreadId: null,
    replyBuffer: '',
    generalCommentsIndex: 0,
    generalCommentsScrollOffset: 0,
    sessionMenu: null,
    reviewInstruction: '',
    reconnectKey: 0,
    annotatingPlanKey: null,
    annotationBuffer: '',
    priorPaneMode: 'terminal',
    planCheckoutIndex: 0,
    planCheckoutTarget: null,
    ...initial,
  };

  function updater<T>(key: string): (upd: T | ((prev: T) => T)) => void {
    return (upd) => {
      state[key] =
        typeof upd === 'function'
          ? (upd as (p: unknown) => unknown)(state[key])
          : upd;
    };
  }

  return {
    get paneMode() {
      return state.paneMode as PaneModeValue['paneMode'];
    },
    setPaneMode: (m) => {
      state.paneMode = m;
    },
    get diffFileIndex() {
      return state.diffFileIndex as number;
    },
    setDiffFileIndex: updater<number>('diffFileIndex'),
    get diffViewFile() {
      return state.diffViewFile as string | null;
    },
    setDiffViewFile: (f) => {
      state.diffViewFile = f;
    },
    get diffScrollOffset() {
      return state.diffScrollOffset as number;
    },
    setDiffScrollOffset: updater<number>('diffScrollOffset'),
    get diffListScrollRow() {
      return state.diffListScrollRow as number;
    },
    setDiffListScrollRow: updater<number>('diffListScrollRow'),
    get showSkipped() {
      return state.showSkipped as boolean;
    },
    setShowSkipped: updater<boolean>('showSkipped'),
    get selectedCommentId() {
      return state.selectedCommentId as string | null;
    },
    setSelectedCommentId: (id) => {
      state.selectedCommentId = id;
    },
    get pendingDeleteCommentId() {
      return state.pendingDeleteCommentId as string | null;
    },
    setPendingDeleteCommentId: (id) => {
      state.pendingDeleteCommentId = id;
    },
    get editingCommentId() {
      return state.editingCommentId as string | null;
    },
    setEditingCommentId: (id) => {
      state.editingCommentId = id;
    },
    get editBuffer() {
      return state.editBuffer as string;
    },
    setEditBuffer: updater<string>('editBuffer'),
    get replyingToThreadId() {
      return state.replyingToThreadId as string | null;
    },
    setReplyingToThreadId: (id) => {
      state.replyingToThreadId = id;
    },
    get replyBuffer() {
      return state.replyBuffer as string;
    },
    setReplyBuffer: updater<string>('replyBuffer'),
    get generalCommentsIndex() {
      return state.generalCommentsIndex as number;
    },
    setGeneralCommentsIndex: updater<number>('generalCommentsIndex'),
    get generalCommentsScrollOffset() {
      return state.generalCommentsScrollOffset as number;
    },
    setGeneralCommentsScrollOffset: updater<number>(
      'generalCommentsScrollOffset'
    ),
    get sessionMenu() {
      return state.sessionMenu as PaneModeValue['sessionMenu'];
    },
    setSessionMenu: updater<PaneModeValue['sessionMenu']>('sessionMenu'),
    get reviewInstruction() {
      return state.reviewInstruction as string;
    },
    setReviewInstruction: updater<string>('reviewInstruction'),
    get reconnectKey() {
      return state.reconnectKey as number;
    },
    setReconnectKey: updater<number>('reconnectKey'),
    get annotatingPlanKey() {
      return state.annotatingPlanKey as string | null;
    },
    setAnnotatingPlanKey: (k) => {
      state.annotatingPlanKey = k;
    },
    get annotationBuffer() {
      return state.annotationBuffer as string;
    },
    setAnnotationBuffer: updater<string>('annotationBuffer'),
    get priorPaneMode() {
      return state.priorPaneMode as PaneModeValue['priorPaneMode'];
    },
    setPriorPaneMode: (m) => {
      state.priorPaneMode = m;
    },
    get planCheckoutIndex() {
      return state.planCheckoutIndex as number;
    },
    setPlanCheckoutIndex: updater<number>('planCheckoutIndex'),
    get planCheckoutTarget() {
      return state.planCheckoutTarget as PaneModeValue['planCheckoutTarget'];
    },
    setPlanCheckoutTarget: (t) => {
      state.planCheckoutTarget = t;
    },
  } as PaneModeValue;
}

function makeCtx(overrides: {
  pane: PaneModeValue;
  files: DiffFile[];
  shownGeneralComments: RemoteCommentThread[];
  listSpans?: number[];
  listViewportRows?: number;
  sessions?: Partial<SessionActionsContextValue>;
  remoteCtx?: {
    replyToThread?: ReturnType<typeof vi.fn>;
    toggleResolved?: ReturnType<typeof vi.fn>;
    refresh?: ReturnType<typeof vi.fn>;
  };
  plan?: Partial<Record<keyof PlanValue, unknown>>;
  prId?: number;
}): DiffFileListHandlerCtx {
  const {
    pane,
    files,
    shownGeneralComments,
    listSpans,
    listViewportRows,
    sessions,
    remoteCtx,
    plan,
    prId,
  } = overrides;
  return {
    pane,
    diffFiles: files,
    fileCount: files.length,
    diffDisplayCount: files.length + shownGeneralComments.length,
    shownGeneralComments,
    // Default unified geometry: file rows are 1 row, every comment
    // card 5 rows, in a 10-row viewport — tall-card tests override.
    listSpans: listSpans ?? [
      ...files.map(() => 1),
      ...shownGeneralComments.map(() => 5),
    ],
    listViewportRows: listViewportRows ?? 10,
    // Resolution runs against the real Normie preset, so these tests
    // break if a binding moves — which is the point of driving the
    // handler through `resolve` rather than passing action IDs in.
    keybinds: {
      presetId: NORMIE_PRESET.id,
      presetName: NORMIE_PRESET.name,
      bindings: NORMIE_PRESET.bindings,
      resolve: (
        input: string,
        key: KeyPress,
        context: Parameters<typeof resolveAction>[2]
      ) => resolveAction(input, key, context, NORMIE_PRESET.bindings, ACTIONS),
      getHintKeys: () => '',
      getNavKeys: () => '',
      getHints: () => [],
      isCustom: () => false,
    },
    sessions: {
      flashStatus: vi.fn(),
      ...sessions,
    } as unknown as SessionActionsContextValue,
    remoteCtx: {
      replyToThread: vi.fn().mockResolvedValue({
        id: 'reply',
        author: 'me',
        body: 'ok',
        createdAt: new Date().toISOString(),
      }),
      toggleResolved: vi.fn().mockResolvedValue(true),
      refresh: vi.fn(),
      ...remoteCtx,
    },
    // Empty plan store: none of the list-navigation paths under test
    // read it, but the handler ctx carries one, and leaving it off
    // meant the harness had drifted from the shape production passes.
    plan: {
      snapshot: new Map(),
      add: vi.fn(),
      remove: vi.fn(),
      has: vi.fn().mockReturnValue(false),
      toggle: vi.fn().mockReturnValue(true),
      annotate: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      count: vi.fn().mockReturnValue(0),
      clear: vi.fn(),
      ...plan,
    } as unknown as PlanValue,
    prId,
  } as DiffFileListHandlerCtx;
}

// ── j/k viewport stepping over the unified list ──────────────────

describe('diff-file-list handler — unified viewport stepping', () => {
  it('j from the last file moves onto comment 0 and scrolls it into view', () => {
    // spans [1,1,5,5]; comment 0 occupies rows 2..7. From offset 7 the
    // card is above the viewport top, so selecting it scrolls back up.
    const pane = makePane({ diffFileIndex: 1, diffListScrollRow: 7 });
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const threads = [makeThread('t1'), makeThread('t2')];
    const ctx = makeCtx({ pane, files, shownGeneralComments: threads });
    handleDiffFileListInput('', makeKey({ downArrow: true }), ctx);
    expect(pane.diffFileIndex).toBe(2);
    expect(pane.diffListScrollRow).toBe(2);
  });

  it('j scrolls within a card taller than the viewport', () => {
    // spans [1,30] in a 10-row viewport: j advances the offset by half
    // the viewport and keeps the selection on the card.
    const pane = makePane({ diffFileIndex: 1, diffListScrollRow: 0 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('t1')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
      listSpans: [1, 30],
      listViewportRows: 10,
    });
    handleDiffFileListInput('', makeKey({ downArrow: true }), ctx);
    expect(pane.diffFileIndex).toBe(1);
    expect(pane.diffListScrollRow).toBe(5);
  });

  it('j advances to the next card once the tall card bottom is visible', () => {
    // Tall card spans rows 1..31; offset 21 shows its bottom in a
    // 10-row viewport, so j moves selection and scrolls card 1
    // (rows 31..36) into view.
    const pane = makePane({ diffFileIndex: 1, diffListScrollRow: 21 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('t1'), makeThread('t2')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
      listSpans: [1, 30, 5],
      listViewportRows: 10,
    });
    handleDiffFileListInput('', makeKey({ downArrow: true }), ctx);
    expect(pane.diffFileIndex).toBe(2);
    expect(pane.diffListScrollRow).toBe(26); // rows 31..36 bottom-aligned
  });

  it('k scrolls back up within a tall card before leaving it', () => {
    const pane = makePane({ diffFileIndex: 1, diffListScrollRow: 21 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('t1')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
      listSpans: [1, 30],
      listViewportRows: 10,
    });
    handleDiffFileListInput('', makeKey({ upArrow: true }), ctx);
    expect(pane.diffFileIndex).toBe(1);
    expect(pane.diffListScrollRow).toBe(16);
  });

  it('k from the first comment moves back onto the last file', () => {
    const pane = makePane({ diffFileIndex: 1, diffListScrollRow: 0 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('t1'), makeThread('t2')];
    const ctx = makeCtx({ pane, files, shownGeneralComments: threads });
    handleDiffFileListInput('', makeKey({ upArrow: true }), ctx);
    expect(pane.diffFileIndex).toBe(0);
  });

  it('j on the last item with its bottom in view is a no-op', () => {
    // spans [1,5,5] total 11; offset 1 shows rows 1..11 → last card's
    // bottom edge is visible, so j has nowhere to go.
    const pane = makePane({ diffFileIndex: 2, diffListScrollRow: 1 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('t1'), makeThread('t2')];
    const ctx = makeCtx({ pane, files, shownGeneralComments: threads });
    handleDiffFileListInput('', makeKey({ downArrow: true }), ctx);
    expect(pane.diffFileIndex).toBe(2);
    expect(pane.diffListScrollRow).toBe(1);
  });

  it('Shift+Down scrolls the target comment into view', () => {
    // Jump from comment 0 to comment 1 (rows 6..11) in a 5-row
    // viewport: offset must move so the card is visible.
    const pane = makePane({ diffFileIndex: 1, diffListScrollRow: 0 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('t1'), makeThread('t2')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
      listViewportRows: 5,
    });
    handleDiffFileListInput('', makeKey({ downArrow: true, shift: true }), ctx);
    expect(pane.diffFileIndex).toBe(2);
    expect(pane.diffListScrollRow).toBe(6);
  });
});

// ── next-comment / prev-comment ──────────────────────────────────

describe('diff-file-list handler — next-comment / prev-comment', () => {
  it('Shift+Down from a file row jumps to first comment', () => {
    const pane = makePane({ diffFileIndex: 0 });
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const threads = [makeThread('t1'), makeThread('t2')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
    });
    handleDiffFileListInput('', makeKey({ downArrow: true, shift: true }), ctx);
    // fileCount === 2 → selection lands on first comment at index 2
    expect(pane.diffFileIndex).toBe(2);
  });

  it('Shift+Down wraps from last comment to first', () => {
    const pane = makePane({ diffFileIndex: 3 }); // last comment
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const threads = [makeThread('t1'), makeThread('t2')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
    });
    handleDiffFileListInput('', makeKey({ downArrow: true, shift: true }), ctx);
    // wraps to first comment
    expect(pane.diffFileIndex).toBe(2);
  });

  it('Shift+Up from files jumps to last comment', () => {
    const pane = makePane({ diffFileIndex: 0 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('t1'), makeThread('t2'), makeThread('t3')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
    });
    handleDiffFileListInput('', makeKey({ upArrow: true, shift: true }), ctx);
    expect(pane.diffFileIndex).toBe(3); // last comment
  });

  it('no-ops when no comments exist', () => {
    const pane = makePane({ diffFileIndex: 0 });
    const files = [makeFile('a.ts')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: [],
    });
    handleDiffFileListInput('', makeKey({ downArrow: true, shift: true }), ctx);
    expect(pane.diffFileIndex).toBe(0);
  });
});

// ── next-section / prev-section ──────────────────────────────────

describe('diff-file-list handler — section jumps', () => {
  it('Ctrl+Down from files jumps to first comment', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const threads = [makeThread('t1'), makeThread('t2')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
    });
    handleDiffFileListInput('', makeKey({ downArrow: true, ctrl: true }), ctx);
    expect(pane.diffFileIndex).toBe(2);
  });

  it('Ctrl+Up from a comment jumps back to first file', () => {
    const pane = makePane({ diffFileIndex: 3 });
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const threads = [makeThread('t1'), makeThread('t2')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
    });
    handleDiffFileListInput('', makeKey({ upArrow: true, ctrl: true }), ctx);
    expect(pane.diffFileIndex).toBe(0);
  });

  // Regression: next-section used to fall through to clampToLastComment
  // when there were no comments — landing the cursor on the last file
  // unexpectedly instead of staying put.
  it('Ctrl+Down with no comments is a no-op', () => {
    const pane = makePane({ diffFileIndex: 0 });
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: [],
    });
    handleDiffFileListInput('', makeKey({ downArrow: true, ctrl: true }), ctx);
    expect(pane.diffFileIndex).toBe(0);
  });

  it('Ctrl+Up from a file (no comments) is a no-op', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: [],
    });
    handleDiffFileListInput('', makeKey({ upArrow: true, ctrl: true }), ctx);
    // Cursor stays where it was — no comments means no section to leave.
    expect(pane.diffFileIndex).toBe(1);
  });
});

// ── reply-to-thread ──────────────────────────────────────────────

describe('diff-file-list handler — reply-to-thread', () => {
  it('r on a selected comment enters reply mode', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('target'), makeThread('other')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
    });
    handleDiffFileListInput('r', makeKey(), ctx);
    expect(pane.replyingToThreadId).toBe('target');
    expect(pane.replyBuffer).toBe('');
  });

  it('r on a selected file is a no-op', () => {
    const pane = makePane({ diffFileIndex: 0 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('t1')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
    });
    handleDiffFileListInput('r', makeKey(), ctx);
    expect(pane.replyingToThreadId).toBeNull();
  });

  /** Remote threads are cached for the life of the PR view, so the
   *  reader can be looking at a conversation that has since been
   *  answered. Opening the composer re-reads it. */
  it('r re-reads the conversation as the composer opens', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const refresh = vi.fn();
    const flashStatus = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target')],
      remoteCtx: { refresh },
      sessions: { flashStatus },
    });
    handleDiffFileListInput('r', makeKey(), ctx);
    // The composer is usable on this keypress; the fetch runs behind it.
    expect(pane.replyingToThreadId).toBe('target');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(flashStatus).toHaveBeenCalledWith('Checking for new comments...');
  });

  it('does not re-read when there is no thread to reply to', () => {
    const refresh = vi.fn();
    const ctx = makeCtx({
      pane: makePane({ diffFileIndex: 0 }),
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('t1')],
      remoteCtx: { refresh },
    });
    handleDiffFileListInput('r', makeKey(), ctx);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ── toggle-thread-resolved ───────────────────────────────────────

describe('diff-file-list handler — toggle-thread-resolved', () => {
  it('v on a selected unresolved comment calls toggleResolved(id, true)', async () => {
    const pane = makePane({ diffFileIndex: 1 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('target')];
    const toggleResolved = vi.fn().mockResolvedValue(true);
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
      remoteCtx: { toggleResolved },
    });
    handleDiffFileListInput('v', makeKey(), ctx);
    // Let the microtask queue drain so the flashStatus assertion fires
    await new Promise((r) => setTimeout(r, 0));
    expect(toggleResolved).toHaveBeenCalledWith('target', true);
  });

  it('v on a selected resolved comment calls toggleResolved(id, false)', async () => {
    const pane = makePane({ diffFileIndex: 1 });
    const files = [makeFile('a.ts')];
    const resolved = makeThread('target');
    resolved.isResolved = true;
    const toggleResolved = vi.fn().mockResolvedValue(true);
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: [resolved],
      remoteCtx: { toggleResolved },
    });
    handleDiffFileListInput('v', makeKey(), ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(toggleResolved).toHaveBeenCalledWith('target', false);
  });

  it('v on a file row is a no-op', () => {
    const pane = makePane({ diffFileIndex: 0 });
    const files = [makeFile('a.ts')];
    const toggleResolved = vi.fn();
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: [makeThread('t1')],
      remoteCtx: { toggleResolved },
    });
    handleDiffFileListInput('v', makeKey(), ctx);
    expect(toggleResolved).not.toHaveBeenCalled();
  });
});

// ── reply-mode guard ─────────────────────────────────────────────

describe('diff-file-list handler — reply-mode guard', () => {
  let pane: PaneModeValue;
  let ctx: DiffFileListHandlerCtx;
  let replyToThread: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pane = makePane({
      diffFileIndex: 1,
      replyingToThreadId: 'target',
      replyBuffer: '',
    });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('target')];
    replyToThread = vi.fn().mockResolvedValue({
      id: 'reply',
      author: 'me',
      body: 'ok',
      createdAt: new Date().toISOString(),
    });
    ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
      remoteCtx: { replyToThread },
    });
  });

  it('Esc cancels reply mode', () => {
    handleDiffFileListInput('', makeKey({ escape: true }), ctx);
    expect(pane.replyingToThreadId).toBeNull();
    expect(pane.replyBuffer).toBe('');
  });

  it('printable character appends to replyBuffer without firing actions', () => {
    // 'r' is bound to reply-to-thread but must NOT trigger a new reply
    // while already in reply mode — it should just append to the buffer.
    handleDiffFileListInput('r', makeKey(), ctx);
    expect(pane.replyBuffer).toBe('r');
    expect(pane.replyingToThreadId).toBe('target');
  });

  it('Enter with non-empty buffer calls replyToThread', async () => {
    pane.setReplyBuffer(() => 'hello');
    handleDiffFileListInput('', makeKey({ return: true }), ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(replyToThread).toHaveBeenCalledWith('target', 'hello');
  });

  it('Enter with empty buffer is a no-op', () => {
    handleDiffFileListInput('', makeKey({ return: true }), ctx);
    expect(replyToThread).not.toHaveBeenCalled();
    // stays in reply mode — user may still type
    expect(pane.replyingToThreadId).toBe('target');
  });
});

// ── open on a comment ────────────────────────────────────────────

describe('diff-file-list handler — open (Enter) on a comment', () => {
  it('Enter on a comment enters reply mode (not pane hop)', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const files = [makeFile('a.ts')];
    const threads = [makeThread('target')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: threads,
    });
    handleDiffFileListInput('', makeKey({ return: true }), ctx);
    expect(pane.paneMode).toBe('diff');
    expect(pane.replyingToThreadId).toBe('target');
  });

  it('Enter on a file still opens the diff viewer', () => {
    const pane = makePane({ diffFileIndex: 0 });
    const files = [makeFile('a.ts')];
    const ctx = makeCtx({
      pane,
      files,
      shownGeneralComments: [],
    });
    handleDiffFileListInput('', makeKey({ return: true }), ctx);
    expect(pane.paneMode).toBe('diff-file');
    expect(pane.diffViewFile).toBe('a.ts');
  });

  it('Enter on an empty list leaves the pane alone', () => {
    // Nothing to open: `open` is gated on diffDisplayCount > 0, so the
    // pane must not hop to the viewer with a null file.
    const pane = makePane({ diffFileIndex: 0 });
    const ctx = makeCtx({ pane, files: [], shownGeneralComments: [] });
    handleDiffFileListInput('', makeKey({ return: true }), ctx);
    expect(pane.paneMode).toBe('diff');
    expect(pane.diffViewFile).toBeNull();
    expect(pane.replyingToThreadId).toBeNull();
  });
});

// ── back ─────────────────────────────────────────────────────────

describe('diff-file-list handler — back', () => {
  it('Esc returns to the PR detail pane', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('t1')],
    });
    handleDiffFileListInput('', makeKey({ escape: true }), ctx);
    expect(pane.paneMode).toBe('pr-detail');
  });
});

// ── toggle-skipped ───────────────────────────────────────────────

describe('diff-file-list handler — toggle-skipped', () => {
  it('s flips showSkipped and resets selection and scroll', () => {
    // The visible file set changes under the cursor, so the handler
    // rewinds to the top rather than leaving a stale index/offset.
    const pane = makePane({
      diffFileIndex: 3,
      diffListScrollRow: 9,
      showSkipped: false,
    });
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts'), makeFile('b.ts')],
      shownGeneralComments: [makeThread('t1'), makeThread('t2')],
    });
    handleDiffFileListInput('s', makeKey(), ctx);
    expect(pane.showSkipped).toBe(true);
    expect(pane.diffFileIndex).toBe(0);
    expect(pane.diffListScrollRow).toBe(0);
  });

  it('s toggles back off', () => {
    const pane = makePane({ showSkipped: true });
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [],
    });
    handleDiffFileListInput('s', makeKey(), ctx);
    expect(pane.showSkipped).toBe(false);
  });
});

// ── toggle-thread-resolved status messages ───────────────────────

describe('diff-file-list handler — resolve status feedback', () => {
  it('flashes progress then success when the toggle succeeds', async () => {
    const pane = makePane({ diffFileIndex: 1 });
    const flashStatus = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target')],
      sessions: { flashStatus },
      remoteCtx: { toggleResolved: vi.fn().mockResolvedValue(true) },
    });
    handleDiffFileListInput('v', makeKey(), ctx);
    expect(flashStatus).toHaveBeenCalledWith('Resolving thread...');
    await new Promise((r) => setTimeout(r, 0));
    expect(flashStatus).toHaveBeenCalledWith('Thread resolved');
  });

  it('stays silent past the progress message when the toggle reports failure', async () => {
    const pane = makePane({ diffFileIndex: 1 });
    const flashStatus = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target')],
      sessions: { flashStatus },
      remoteCtx: { toggleResolved: vi.fn().mockResolvedValue(false) },
    });
    handleDiffFileListInput('v', makeKey(), ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(flashStatus).toHaveBeenCalledTimes(1);
    expect(flashStatus).toHaveBeenCalledWith('Resolving thread...');
  });

  it('reports the error message when the toggle rejects', async () => {
    const pane = makePane({ diffFileIndex: 1 });
    const flashStatus = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target')],
      sessions: { flashStatus },
      remoteCtx: {
        toggleResolved: vi.fn().mockRejectedValue(new Error('offline')),
      },
    });
    handleDiffFileListInput('v', makeKey(), ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(flashStatus).toHaveBeenCalledWith('Failed: offline');
  });

  it('reopening an already-resolved thread flashes the reopen wording', async () => {
    const pane = makePane({ diffFileIndex: 1 });
    const flashStatus = vi.fn();
    const resolved = makeThread('target');
    resolved.isResolved = true;
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [resolved],
      sessions: { flashStatus },
    });
    handleDiffFileListInput('v', makeKey(), ctx);
    expect(flashStatus).toHaveBeenCalledWith('Reopening thread...');
    await new Promise((r) => setTimeout(r, 0));
    expect(flashStatus).toHaveBeenCalledWith('Thread reopened');
  });
});

// ── plan-toggle ──────────────────────────────────────────────────

describe('diff-file-list handler — plan-toggle', () => {
  it('a on a selected comment toggles a remote snapshot into the plan', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const toggle = vi.fn().mockReturnValue(true);
    const flashStatus = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target', 'please fix')],
      sessions: { flashStatus },
      plan: { toggle },
      prId: 42,
    });
    handleDiffFileListInput('a', makeKey(), ctx);
    expect(toggle).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        kind: 'remote',
        id: 'target',
        body: 'please fix',
      })
    );
    expect(flashStatus).toHaveBeenCalledWith('Added to plan');
  });

  it('a flashes the removal wording when the item was already in the plan', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const flashStatus = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target')],
      sessions: { flashStatus },
      plan: { toggle: vi.fn().mockReturnValue(false) },
      prId: 42,
    });
    handleDiffFileListInput('a', makeKey(), ctx);
    expect(flashStatus).toHaveBeenCalledWith('Removed from plan');
  });

  it('a on a file row is a no-op', () => {
    const pane = makePane({ diffFileIndex: 0 });
    const toggle = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('t1')],
      plan: { toggle },
      prId: 42,
    });
    handleDiffFileListInput('a', makeKey(), ctx);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('a is a no-op before the PR id has resolved', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const toggle = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('t1')],
      plan: { toggle },
      // no prId
    });
    handleDiffFileListInput('a', makeKey(), ctx);
    expect(toggle).not.toHaveBeenCalled();
  });
});

// ── plan-annotate ────────────────────────────────────────────────

describe('diff-file-list handler — plan-annotate', () => {
  it('Shift+A adds the comment and opens the note composer empty', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const add = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target')],
      plan: { add, list: vi.fn().mockReturnValue([]) },
      prId: 7,
    });
    handleDiffFileListInput('A', makeKey({ shift: true }), ctx);
    expect(add).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ kind: 'remote', id: 'target' })
    );
    expect(pane.annotatingPlanKey).toBe(planItemKey('remote', 'target'));
    expect(pane.annotationBuffer).toBe('');
  });

  it('Shift+A seeds the composer with the existing annotation', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target')],
      plan: {
        add: vi.fn(),
        list: vi.fn().mockReturnValue([
          { kind: 'remote', id: 'target', annotation: 'old note' },
          { kind: 'remote', id: 'other', annotation: 'wrong note' },
        ]),
      },
      prId: 7,
    });
    handleDiffFileListInput('A', makeKey({ shift: true }), ctx);
    expect(pane.annotationBuffer).toBe('old note');
  });

  it('Shift+A on a file row is a no-op', () => {
    const pane = makePane({ diffFileIndex: 0 });
    const add = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('t1')],
      plan: { add },
      prId: 7,
    });
    handleDiffFileListInput('A', makeKey({ shift: true }), ctx);
    expect(add).not.toHaveBeenCalled();
    expect(pane.annotatingPlanKey).toBeNull();
  });
});

// ── plan-annotate mode guard ─────────────────────────────────────

describe('diff-file-list handler — plan-annotate mode guard', () => {
  it('printable characters edit the note instead of firing actions', () => {
    // 'r' is bound to reply-to-thread; while composing a note it must
    // only reach the annotation buffer.
    const pane = makePane({
      diffFileIndex: 1,
      annotatingPlanKey: planItemKey('remote', 'target'),
      annotationBuffer: '',
    });
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target')],
      prId: 7,
    });
    handleDiffFileListInput('r', makeKey(), ctx);
    expect(pane.annotationBuffer).toBe('r');
    expect(pane.replyingToThreadId).toBeNull();
  });

  it('Enter commits the note and closes the composer', () => {
    const annotate = vi.fn();
    const pane = makePane({
      diffFileIndex: 1,
      annotatingPlanKey: planItemKey('remote', 'target'),
      annotationBuffer: 'note',
    });
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('target')],
      plan: { annotate },
      prId: 7,
    });
    handleDiffFileListInput('', makeKey({ return: true }), ctx);
    expect(annotate).toHaveBeenCalledWith(7, 'remote', 'target', 'note');
    expect(pane.annotatingPlanKey).toBeNull();
    // Enter did not fall through to `open`.
    expect(pane.paneMode).toBe('diff');
  });
});

// ── plan-checkout ────────────────────────────────────────────────

describe('diff-file-list handler — plan-checkout', () => {
  it('c on an empty plan says so and stays put', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const flashStatus = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('t1')],
      sessions: { flashStatus },
      plan: { count: vi.fn().mockReturnValue(0) },
      prId: 7,
    });
    handleDiffFileListInput('c', makeKey(), ctx);
    expect(flashStatus).toHaveBeenCalledWith('Plan is empty');
    expect(pane.paneMode).toBe('diff');
  });

  it('c with a non-empty plan opens the checkout pane from the top', () => {
    const pane = makePane({
      diffFileIndex: 1,
      planCheckoutIndex: 4,
      planCheckoutTarget: 'inject',
    });
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('t1')],
      plan: { count: vi.fn().mockReturnValue(2) },
      prId: 7,
    });
    handleDiffFileListInput('c', makeKey(), ctx);
    expect(pane.paneMode).toBe('plan-checkout');
    // Esc out of checkout must land back on the list, not the terminal.
    expect(pane.priorPaneMode).toBe('diff');
    expect(pane.planCheckoutIndex).toBe(0);
    expect(pane.planCheckoutTarget).toBeNull();
  });

  it('c is a no-op before the PR id has resolved', () => {
    const pane = makePane({ diffFileIndex: 1 });
    const flashStatus = vi.fn();
    const ctx = makeCtx({
      pane,
      files: [makeFile('a.ts')],
      shownGeneralComments: [makeThread('t1')],
      sessions: { flashStatus },
      plan: { count: vi.fn().mockReturnValue(2) },
      // no prId
    });
    handleDiffFileListInput('c', makeKey(), ctx);
    expect(flashStatus).toHaveBeenCalledWith('Plan is empty');
    expect(pane.paneMode).toBe('diff');
  });
});
