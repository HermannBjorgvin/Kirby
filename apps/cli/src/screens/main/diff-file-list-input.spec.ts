import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Key } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { DiffFile } from '@kirby/diff';
import { handleDiffFileListInput } from './diff-file-list-input.js';
import type { DiffFileListHandlerCtx } from './input-types.js';
import { ACTIONS, NORMIE_PRESET } from '../../keybindings/registry.js';
import { resolveAction } from '../../keybindings/resolver.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import type { SessionActionsContextValue } from '../../context/SessionContext.js';

// ── Test fixtures ────────────────────────────────────────────────

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
    showSkipped: false,
    selectedCommentId: null,
    pendingDeleteCommentId: null,
    editingCommentId: null,
    editBuffer: '',
    replyingToThreadId: null,
    replyBuffer: '',
    generalCommentsIndex: 0,
    generalCommentsScrollOffset: 0,
    reviewConfirm: null,
    reviewInstruction: '',
    reconnectKey: 0,
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
    get reviewConfirm() {
      return state.reviewConfirm as PaneModeValue['reviewConfirm'];
    },
    setReviewConfirm: (c) => {
      state.reviewConfirm = c;
    },
    get reviewInstruction() {
      return state.reviewInstruction as string;
    },
    setReviewInstruction: updater<string>('reviewInstruction'),
    get reconnectKey() {
      return state.reconnectKey as number;
    },
    setReconnectKey: updater<number>('reconnectKey'),
  } as PaneModeValue;
}

function makeCtx(overrides: {
  pane: PaneModeValue;
  files: DiffFile[];
  shownGeneralComments: RemoteCommentThread[];
  sessions?: Partial<SessionActionsContextValue>;
  remoteCtx?: {
    replyToThread?: ReturnType<typeof vi.fn>;
    toggleResolved?: ReturnType<typeof vi.fn>;
  };
}): DiffFileListHandlerCtx {
  const { pane, files, shownGeneralComments, sessions, remoteCtx } = overrides;
  return {
    pane,
    diffFiles: files,
    fileCount: files.length,
    diffDisplayCount: files.length + shownGeneralComments.length,
    shownGeneralComments,
    keybinds: {
      resolve: (input, key, context) =>
        resolveAction(input, key, context, NORMIE_PRESET.bindings, ACTIONS),
      getHintKeys: () => '',
      getNavKeys: () => '',
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
      ...remoteCtx,
    },
  } as DiffFileListHandlerCtx;
}

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
});
