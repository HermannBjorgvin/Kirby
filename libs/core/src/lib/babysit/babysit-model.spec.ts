import { describe, it, expect } from 'vitest';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  BABYSIT_DEBOUNCE_MS,
  BABYSIT_MAX_WAIT_MS,
  diffAgainstReported,
  initialBabysitState,
  isDue,
  observe,
  observeThread,
  takeReport,
  type BabysitObservation,
  type BabysitThread,
} from './babysit-model.js';
import { composeBabysitPrompt } from './babysit-prompt.js';

const MIN = 60_000;

function thread(
  id: string,
  comments: { author: string; body: string }[],
  lastCommentIsOwn = false
): BabysitThread {
  return { id, file: 'src/a.ts', line: 3, comments, lastCommentIsOwn };
}

function seen(over: Partial<BabysitObservation> = {}): BabysitObservation {
  return { buildStatus: 'succeeded', threads: [], conflictCount: 0, ...over };
}

const alice = { author: 'alice', body: 'rename this' };
const bob = { author: 'bob', body: 'agreed' };

describe('diffAgainstReported', () => {
  const reported = initialBabysitState().reported;

  it('is quiet when CI is green, no threads and no conflicts', () => {
    expect(diffAgainstReported(reported, seen())).toBeNull();
  });

  it('does not treat a running build as news', () => {
    expect(
      diffAgainstReported(reported, seen({ buildStatus: 'pending' }))
    ).toBeNull();
  });

  it('reports a failed build', () => {
    const report = diffAgainstReported(
      reported,
      seen({ buildStatus: 'failed' })
    );
    expect(report).toMatchObject({ ciChanged: true, buildStatus: 'failed' });
  });

  it('reports a build going green after a reported red', () => {
    const report = diffAgainstReported(
      { ...reported, buildStatus: 'failed' },
      seen({ buildStatus: 'succeeded' })
    );
    expect(report).toMatchObject({ ciChanged: true, buildStatus: 'succeeded' });
  });

  it('does not repeat a failure the agent already heard', () => {
    expect(
      diffAgainstReported(
        { ...reported, buildStatus: 'failed' },
        seen({ buildStatus: 'failed' })
      )
    ).toBeNull();
  });

  it('reports conflicts once per count', () => {
    expect(
      diffAgainstReported(reported, seen({ conflictCount: 2 }))
    ).toMatchObject({ conflictsChanged: true, conflictCount: 2 });
    expect(
      diffAgainstReported(
        { ...reported, conflictCount: 2 },
        seen({ conflictCount: 2 })
      )
    ).toBeNull();
    expect(
      diffAgainstReported(
        { ...reported, conflictCount: 2 },
        seen({ conflictCount: 0 })
      )
    ).toBeNull();
  });

  it('keeps the reported count when the conflict check could not run', () => {
    expect(
      diffAgainstReported(reported, seen({ conflictCount: null }))
    ).toBeNull();
  });

  it('reports an unseen thread and a thread that gained a reply', () => {
    const first = diffAgainstReported(
      reported,
      seen({ threads: [thread('t1', [alice])] })
    );
    expect(first?.newThreads.map((t) => t.id)).toEqual(['t1']);

    const known = { ...reported, threadComments: { t1: 1 } };
    expect(
      diffAgainstReported(known, seen({ threads: [thread('t1', [alice])] }))
    ).toBeNull();
    const grown = diffAgainstReported(
      known,
      seen({ threads: [thread('t1', [alice, bob])] })
    );
    expect(grown?.newThreads.map((t) => t.id)).toEqual(['t1']);
  });

  it('ignores a thread whose newest comment is our own reply', () => {
    const known = { ...reported, threadComments: { t1: 1 } };
    expect(
      diffAgainstReported(
        known,
        seen({ threads: [thread('t1', [alice, bob], true)] })
      )
    ).toBeNull();
  });

  it('always carries the current CI status alongside other news', () => {
    const report = diffAgainstReported(
      reported,
      seen({ buildStatus: 'pending', conflictCount: 1 })
    );
    expect(report).toMatchObject({ buildStatus: 'pending', ciChanged: false });
  });
});

describe('observe / isDue / takeReport', () => {
  it('has nothing due while nothing is pending', () => {
    const state = observe(initialBabysitState(), seen(), 0);
    expect(isDue(state, BABYSIT_MAX_WAIT_MS * 2)).toBe(false);
    expect(takeReport(state, 0)).toBeNull();
  });

  it('sends after the update has been quiet for the debounce', () => {
    let state = observe(
      initialBabysitState(),
      seen({ buildStatus: 'failed' }),
      0
    );
    expect(isDue(state, BABYSIT_DEBOUNCE_MS - 1)).toBe(false);
    expect(isDue(state, BABYSIT_DEBOUNCE_MS)).toBe(true);
    state = observe(state, seen({ buildStatus: 'failed' }), 5 * MIN);
    expect(isDue(state, BABYSIT_DEBOUNCE_MS)).toBe(true);
  });

  it('restarts the quiet period when the update grows', () => {
    let state = observe(
      initialBabysitState(),
      seen({ buildStatus: 'failed' }),
      0
    );
    state = observe(
      state,
      seen({ buildStatus: 'failed', threads: [thread('t1', [alice])] }),
      8 * MIN
    );
    expect(isDue(state, 10 * MIN)).toBe(false);
    expect(isDue(state, 18 * MIN)).toBe(true);
  });

  it('sends anyway once the update has waited the maximum', () => {
    let state = observe(
      initialBabysitState(),
      seen({ buildStatus: 'failed' }),
      0
    );
    for (let i = 1; i <= 6; i++) {
      state = observe(
        state,
        seen({
          buildStatus: 'failed',
          threads: [
            thread(
              't1',
              Array.from({ length: i }, () => alice)
            ),
          ],
        }),
        i * 5 * MIN
      );
    }
    expect(isDue(state, BABYSIT_MAX_WAIT_MS)).toBe(true);
  });

  it('drops the pending update when the news goes away', () => {
    let state = observe(initialBabysitState(), seen({ conflictCount: 2 }), 0);
    state = observe(state, seen({ conflictCount: 0 }), MIN);
    expect(state.pendingSince).toBeNull();
    expect(isDue(state, BABYSIT_MAX_WAIT_MS)).toBe(false);
  });

  it('takes the report and remembers all of it as told', () => {
    const state = observe(
      initialBabysitState(),
      seen({
        buildStatus: 'failed',
        threads: [thread('t1', [alice]), thread('t2', [alice, bob])],
      }),
      0
    );
    const taken = takeReport(state, BABYSIT_DEBOUNCE_MS);
    expect(taken?.report.newThreads.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(taken?.state.reported).toEqual({
      buildStatus: 'failed',
      conflictCount: 0,
      threadComments: { t1: 1, t2: 2 },
    });
    expect(taken?.state.pendingSince).toBeNull();
    expect(taken?.state.lastDeliveredAt).toBe(BABYSIT_DEBOUNCE_MS);
    expect(
      observe(taken!.state, state.latest!, BABYSIT_DEBOUNCE_MS + MIN)
        .pendingSince
    ).toBeNull();
  });

  it('does not let a pending build overwrite a reported verdict', () => {
    const state = observe(
      {
        ...initialBabysitState(),
        reported: {
          buildStatus: 'failed',
          conflictCount: 0,
          threadComments: {},
        },
      },
      seen({ buildStatus: 'pending', threads: [thread('t1', [alice])] }),
      0
    );
    expect(takeReport(state, 0)?.state.reported.buildStatus).toBe('failed');
  });
});

describe('observeThread', () => {
  it('projects a provider thread and flags an own last comment', () => {
    const remote: RemoteCommentThread = {
      id: 'PRRT_1',
      file: 'src/a.ts',
      lineStart: 7,
      lineEnd: 9,
      side: 'RIGHT',
      isResolved: false,
      isOutdated: false,
      canResolve: true,
      comments: [
        { id: 'c1', author: 'alice', body: 'why?', createdAt: '' },
        { id: 'c2', author: 'me', body: 'because', createdAt: '' },
      ],
    };
    const result = observeThread(remote, (a) => a === 'me');
    expect(result).toEqual({
      id: 'PRRT_1',
      file: 'src/a.ts',
      line: 7,
      comments: [
        { author: 'alice', body: 'why?' },
        { author: 'me', body: 'because' },
      ],
      lastCommentIsOwn: true,
    });
  });
});

describe('composeBabysitPrompt', () => {
  const pr = {
    id: 42,
    title: 'Add thing',
    sourceBranch: 'feat',
    targetBranch: 'master',
  };

  it('numbers threads, names their ids and states CI and conflicts', () => {
    const prompt = composeBabysitPrompt(pr, {
      buildStatus: 'failed',
      ciChanged: true,
      conflictsChanged: true,
      conflictCount: 2,
      newThreads: [thread('PRRT_1', [alice, bob])],
    });
    expect(prompt).toBe(
      [
        'Status update for PR #42 ("Add thing", feat → master):',
        '',
        'CI: failed (changed since you were last told). Find out why and fix it.',
        'Conflicts: 2 files conflict with the latest origin/master. Merge or rebase onto it and resolve them.',
        '',
        'Unresolved review comments you have not been told about:',
        '',
        '### 1. src/a.ts:3  (thread PRRT_1)',
        '@alice: rename this',
        '  ↳ @bob: agreed',
        '',
        'Address whatever needs addressing, push your changes, and reply to or resolve the threads you handled.',
      ].join('\n')
    );
  });

  it('omits the comments section when there are none', () => {
    const prompt = composeBabysitPrompt(pr, {
      buildStatus: 'succeeded',
      ciChanged: true,
      conflictsChanged: false,
      conflictCount: 0,
      newThreads: [],
    });
    expect(prompt).toContain('CI: passed (changed since you were last told).');
    expect(prompt).toContain('Conflicts: none against the latest master.');
    expect(prompt).not.toContain('Unresolved review comments');
  });
});
