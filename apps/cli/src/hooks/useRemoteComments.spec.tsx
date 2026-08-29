import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import type {
  VcsProvider,
  PullRequestComments,
  RemoteCommentThread,
  RemoteCommentReply,
} from '@kirby/vcs-core';
import { useRemoteComments } from '@kirby/app-core';

// ── Test helpers ────────────────────────────────────────────────

function makeThread(
  overrides: Partial<RemoteCommentThread> & { id: string }
): RemoteCommentThread {
  return {
    file: 'foo.ts',
    lineStart: 1,
    lineEnd: 1,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: `${overrides.id}-c1`,
        author: 'alice',
        body: 'hi',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

type HookValue = ReturnType<typeof useRemoteComments>;

// Stable empty objects shared across renders so the hook's internal
// useCallback dep array doesn't change on every render (which would
// re-run the fetch effect and re-fire the request).
const EMPTY_AUTH = Object.freeze({}) as Record<string, string>;
const EMPTY_PROJECT = Object.freeze({}) as Record<string, string>;

// Probe mounts the hook and captures its latest return value into `outRef`.
function mountProbe(
  prId: number | null,
  provider: VcsProvider | null,
  onResolvedChange?: () => void,
  onFetchError?: (message: string) => void
): {
  outRef: { current: HookValue | null };
  unmount: () => void;
  setPrId: (next: number | null) => void;
} {
  const outRef: { current: HookValue | null } = { current: null };

  function Probe({ prId: currentPrId }: { prId: number | null }) {
    const value = useRemoteComments(
      currentPrId,
      provider,
      EMPTY_AUTH,
      EMPTY_PROJECT,
      onResolvedChange,
      onFetchError
    );
    // Capture on every render via an effect — direct assignment
    // during render is blocked by the react-hooks/immutability rule.
    useEffect(() => {
      outRef.current = value;
    });
    return <Box />;
  }

  const { unmount, rerender } = render(<Probe prId={prId} />);
  return {
    outRef,
    unmount,
    setPrId: (next) => rerender(<Probe prId={next} />),
  };
}

// A promise whose settlement the test controls, so a fetch can be held
// in flight across an unmount or a PR switch.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nothing awaits a rejection until the hook does; keep node quiet.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

// Flush microtasks + macrotasks so pending fetches resolve and React
// commits resulting state updates into the probe.
async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

// Poll until the probe shows the expected state, or give up.
async function waitForState(
  ref: { current: HookValue | null },
  predicate: (v: HookValue) => boolean,
  attempts = 25
) {
  for (let i = 0; i < attempts; i++) {
    if (ref.current && predicate(ref.current)) return;
    await flush();
  }
}

// ── Tests ───────────────────────────────────────────────────────

describe('useRemoteComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty state when prId is null', async () => {
    const provider = {
      id: 'github',
      fetchCommentThreads: vi.fn(),
    } as unknown as VcsProvider;

    const { outRef, unmount } = mountProbe(null, provider);
    await flush();

    expect(outRef.current?.threads).toEqual([]);
    expect(outRef.current?.generalComments).toEqual([]);
    expect(provider.fetchCommentThreads).not.toHaveBeenCalled();
    unmount();
  });

  it('returns empty state when provider lacks fetchCommentThreads', async () => {
    const provider = { id: 'github' } as unknown as VcsProvider;

    const { outRef, unmount } = mountProbe(42, provider);
    await flush();

    expect(outRef.current?.threads).toEqual([]);
    expect(outRef.current?.loading).toBe(false);
    unmount();
  });

  it('fetches threads on mount and exposes them via hook state', async () => {
    const threads = [makeThread({ id: 't1' })];
    const payload: PullRequestComments = { threads, generalComments: [] };
    const fetchMock = vi.fn().mockResolvedValue(payload);
    const provider = {
      id: 'github',
      fetchCommentThreads: fetchMock,
    } as unknown as VcsProvider;

    const { outRef, unmount } = mountProbe(42, provider);
    await waitForState(outRef, (v) => v.threads.length === 1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outRef.current?.threads).toHaveLength(1);
    expect(outRef.current?.threads[0]?.id).toBe('t1');
    unmount();
  });

  it('replyToThread optimistically appends the reply to the matching thread', async () => {
    const thread = makeThread({ id: 't1' });
    const payload: PullRequestComments = {
      threads: [thread],
      generalComments: [],
    };
    const reply: RemoteCommentReply = {
      id: 'r1',
      author: 'bob',
      body: 'reply body',
      createdAt: '2024-01-02T00:00:00Z',
    };
    const provider = {
      id: 'github',
      fetchCommentThreads: vi.fn().mockResolvedValue(payload),
      replyToThread: vi.fn().mockResolvedValue(reply),
    } as unknown as VcsProvider;

    const { outRef, unmount } = mountProbe(42, provider);
    await waitForState(outRef, (v) => v.threads.length === 1);

    await outRef.current!.replyToThread('t1', 'reply body');
    await waitForState(
      outRef,
      (v) => (v.threads[0]?.comments.length ?? 0) === 2
    );

    expect(outRef.current?.threads[0]?.comments).toHaveLength(2);
    expect(outRef.current?.threads[0]?.comments[1]?.id).toBe('r1');
    unmount();
  });

  it('toggleResolved updates isResolved on the matching thread and fires onResolvedChange', async () => {
    const thread = makeThread({ id: 't1', isResolved: false });
    const payload: PullRequestComments = {
      threads: [thread],
      generalComments: [],
    };
    const provider = {
      id: 'github',
      fetchCommentThreads: vi.fn().mockResolvedValue(payload),
      setThreadResolved: vi.fn().mockResolvedValue(undefined),
    } as unknown as VcsProvider;
    const onResolvedChange = vi.fn();

    const { outRef, unmount } = mountProbe(42, provider, onResolvedChange);
    await waitForState(outRef, (v) => v.threads.length === 1);

    await outRef.current!.toggleResolved('t1', true);
    await waitForState(outRef, (v) => v.threads[0]?.isResolved === true);

    expect(outRef.current?.threads[0]?.isResolved).toBe(true);
    expect(onResolvedChange).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('replyToThread re-throws provider errors so callers can .catch them', async () => {
    // Provider needs the thread in state so the hook can find it before
    // dispatching to provider.replyToThread.
    const payload: PullRequestComments = {
      threads: [makeThread({ id: 't1' })],
      generalComments: [],
    };
    const provider = {
      id: 'github',
      fetchCommentThreads: vi.fn().mockResolvedValue(payload),
      replyToThread: vi.fn().mockRejectedValue(new Error('network boom')),
    } as unknown as VcsProvider;

    const { outRef, unmount } = mountProbe(42, provider);
    await waitForState(outRef, (v) => v.threads.length === 1);

    await expect(outRef.current!.replyToThread('t1', 'x')).rejects.toThrow(
      'network boom'
    );
    unmount();
  });

  it('toggleResolved re-throws provider errors and does not fire onResolvedChange', async () => {
    const provider = {
      id: 'github',
      fetchCommentThreads: vi.fn().mockResolvedValue({
        threads: [makeThread({ id: 't1' })],
        generalComments: [],
      }),
      setThreadResolved: vi.fn().mockRejectedValue(new Error('forbidden')),
    } as unknown as VcsProvider;
    const onResolvedChange = vi.fn();

    const { outRef, unmount } = mountProbe(42, provider, onResolvedChange);
    await waitForState(outRef, (v) => v.threads.length === 1);

    await expect(outRef.current!.toggleResolved('t1', true)).rejects.toThrow(
      'forbidden'
    );
    expect(onResolvedChange).not.toHaveBeenCalled();
    unmount();
  });

  it('does not report a fetch error once the hook has unmounted', async () => {
    const pending = deferred<PullRequestComments>();
    const provider = {
      id: 'github',
      fetchCommentThreads: vi.fn().mockReturnValue(pending.promise),
    } as unknown as VcsProvider;
    const onFetchError = vi.fn();

    const { unmount } = mountProbe(42, provider, undefined, onFetchError);
    await flush();
    expect(provider.fetchCommentThreads).toHaveBeenCalledTimes(1);

    // The user leaves the diff view while the request is still in flight,
    // and only then does it fail. The status bar belongs to a screen that
    // is gone — it must not be flashed.
    unmount();
    pending.reject(new Error('network boom'));
    await flush();

    expect(onFetchError).not.toHaveBeenCalled();
  });

  it('drops a late response for a PR the user has already moved off', async () => {
    const slowPr1 = deferred<PullRequestComments>();
    const fetchMock = vi.fn((_auth, _project, prId: number) =>
      prId === 1
        ? slowPr1.promise
        : Promise.resolve({
            threads: [makeThread({ id: 'pr2-thread' })],
            generalComments: [],
          })
    );
    const provider = {
      id: 'github',
      fetchCommentThreads: fetchMock,
    } as unknown as VcsProvider;

    const { outRef, unmount, setPrId } = mountProbe(1, provider);
    await flush();

    setPrId(2);
    await waitForState(outRef, (v) => v.threads[0]?.id === 'pr2-thread');

    // PR 1's request finally lands. PR 2 is on screen now, so its threads
    // must survive.
    slowPr1.resolve({
      threads: [makeThread({ id: 'pr1-thread' })],
      generalComments: [],
    });
    // Poll for the wrong commit so it has every chance to land before the
    // assertion denies it — a single flush would pass by simply being early.
    await waitForState(outRef, (v) => v.threads[0]?.id === 'pr1-thread');

    expect(outRef.current?.threads.map((t) => t.id)).toEqual(['pr2-thread']);
    unmount();
  });

  it('toggleResolved returns false when provider lacks setThreadResolved', async () => {
    const provider = {
      id: 'github',
      fetchCommentThreads: vi
        .fn()
        .mockResolvedValue({ threads: [], generalComments: [] }),
    } as unknown as VcsProvider;

    const { outRef, unmount } = mountProbe(42, provider);
    await flush();

    const result = await outRef.current!.toggleResolved('t1', true);
    expect(result).toBe(false);
    unmount();
  });
});
