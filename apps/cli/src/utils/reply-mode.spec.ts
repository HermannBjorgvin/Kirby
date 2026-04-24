import { describe, it, expect, vi } from 'vitest';
import type { Key } from 'ink';
import {
  handleReplyModeInput,
  type ReplyModePane,
  type ReplyModeDeps,
} from './reply-mode.js';

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

function makePane(initial: Partial<ReplyModePane> = {}): ReplyModePane {
  const state = {
    replyingToThreadId: initial.replyingToThreadId ?? null,
    replyBuffer: initial.replyBuffer ?? '',
  };
  return {
    get replyingToThreadId() {
      return state.replyingToThreadId;
    },
    get replyBuffer() {
      return state.replyBuffer;
    },
    setReplyingToThreadId: (id) => {
      state.replyingToThreadId = id;
    },
    setReplyBuffer: (upd) => {
      state.replyBuffer =
        typeof upd === 'function' ? upd(state.replyBuffer) : upd;
    },
  } as ReplyModePane;
}

function makeDeps(overrides: Partial<ReplyModeDeps> = {}): ReplyModeDeps & {
  replyToThread: ReturnType<typeof vi.fn>;
  flashStatus: ReturnType<typeof vi.fn>;
} {
  const replyToThread = vi.fn().mockResolvedValue({
    id: 'r',
    author: 'me',
    body: 'ok',
    createdAt: new Date().toISOString(),
  });
  const flashStatus = vi.fn();
  return {
    pane: overrides.pane ?? makePane(),
    flashStatus: overrides.flashStatus ?? flashStatus,
    replyToThread: overrides.replyToThread ?? replyToThread,
    ...({ replyToThread, flashStatus } as object),
  } as ReplyModeDeps & {
    replyToThread: ReturnType<typeof vi.fn>;
    flashStatus: ReturnType<typeof vi.fn>;
  };
}

describe('handleReplyModeInput', () => {
  it('returns false when not in reply mode', () => {
    const deps = makeDeps({ pane: makePane({ replyingToThreadId: null }) });
    expect(handleReplyModeInput('r', makeKey(), deps)).toBe(false);
  });

  it('returns true and clears state on Esc', () => {
    const pane = makePane({
      replyingToThreadId: 't1',
      replyBuffer: 'draft',
    });
    const deps = makeDeps({ pane });
    expect(handleReplyModeInput('', makeKey({ escape: true }), deps)).toBe(
      true
    );
    expect(pane.replyingToThreadId).toBeNull();
    expect(pane.replyBuffer).toBe('');
  });

  it('posts and clears state on Enter with non-empty buffer', async () => {
    const pane = makePane({
      replyingToThreadId: 't1',
      replyBuffer: 'hello',
    });
    const deps = makeDeps({ pane });
    expect(handleReplyModeInput('', makeKey({ return: true }), deps)).toBe(
      true
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.replyToThread).toHaveBeenCalledWith('t1', 'hello');
    expect(pane.replyingToThreadId).toBeNull();
    expect(pane.replyBuffer).toBe('');
  });

  it('keeps buffer + reply mode if network fails', async () => {
    const pane = makePane({
      replyingToThreadId: 't1',
      replyBuffer: 'hello',
    });
    const err = new Error('network down');
    const replyToThread = vi.fn().mockRejectedValue(err);
    const flashStatus = vi.fn();
    const deps: ReplyModeDeps = {
      pane,
      flashStatus,
      replyToThread,
    };
    expect(handleReplyModeInput('', makeKey({ return: true }), deps)).toBe(
      true
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(flashStatus).toHaveBeenCalledWith('Reply failed: network down');
    // Regression guard: user's typed buffer must survive network failure
    expect(pane.replyingToThreadId).toBe('t1');
    expect(pane.replyBuffer).toBe('hello');
  });

  it('Enter with empty buffer is a no-op', () => {
    const pane = makePane({ replyingToThreadId: 't1', replyBuffer: '' });
    const deps = makeDeps({ pane });
    expect(handleReplyModeInput('', makeKey({ return: true }), deps)).toBe(
      true
    );
    expect(deps.replyToThread).not.toHaveBeenCalled();
    // stays in reply mode so user can keep typing
    expect(pane.replyingToThreadId).toBe('t1');
  });

  it('printable characters append to the buffer', () => {
    const pane = makePane({ replyingToThreadId: 't1', replyBuffer: '' });
    const deps = makeDeps({ pane });
    expect(handleReplyModeInput('h', makeKey(), deps)).toBe(true);
    expect(handleReplyModeInput('i', makeKey(), deps)).toBe(true);
    expect(pane.replyBuffer).toBe('hi');
  });
});
