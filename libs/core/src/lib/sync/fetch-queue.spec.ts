import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Two loops fetch in the same repository — the sync pass and every
 * babysitter — and git refuses the second while the first holds a ref
 * lock. So fetches of one repository run one at a time, and a fetch
 * that would only repeat a recent one is answered from it.
 */

const git = vi.hoisted(() => ({
  log: [] as string[],
  /** Release the fetch currently running, in call order. */
  release: [] as ((ok: boolean) => void)[],
  hold: false,
}));

function fetching(label: string): Promise<boolean> {
  git.log.push(`start ${label}`);
  if (!git.hold) {
    git.log.push(`end ${label}`);
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    git.release.push((ok) => {
      git.log.push(`end ${label}`);
      resolve(ok);
    });
  });
}

vi.mock('@kirby/worktree-manager', () => ({
  fetchRemote: (cwd?: string) => fetching(`all@${cwd}`),
  fetchBranches: (refs: string[], cwd?: string) =>
    fetching(`${refs.join(',')}@${cwd}`),
}));

const { fetchRefs, __resetFetchQueueForTests } = await import(
  './fetch-queue.js'
);

async function flush(times = 4) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  git.log = [];
  git.release = [];
  git.hold = false;
  __resetFetchQueueForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fetchRefs', () => {
  it('fetches the refs, or everything, in the repository named', async () => {
    expect(await fetchRefs({ cwd: '/a', refs: ['main', 'feat'] })).toBe(true);
    expect(await fetchRefs({ cwd: '/a', refs: 'all' })).toBe(true);
    expect(git.log).toEqual([
      'start main,feat@/a',
      'end main,feat@/a',
      'start all@/a',
      'end all@/a',
    ]);
  });

  it('runs fetches of one repository one after another', async () => {
    git.hold = true;
    const sync = fetchRefs({ cwd: '/a', refs: 'all' });
    const sitter = fetchRefs({ cwd: '/a', refs: ['main', 'feat'] });
    await flush();
    // The second waits: git would refuse it while the first holds the
    // ref locks, and the babysitter would read that as a failed check.
    expect(git.log).toEqual(['start all@/a']);
    git.release[0](true);
    await flush();
    expect(git.log).toEqual([
      'start all@/a',
      'end all@/a',
      'start main,feat@/a',
    ]);
    git.release[1](true);
    expect(await Promise.all([sync, sitter])).toEqual([true, true]);
  });

  it('lets different repositories fetch at the same time', async () => {
    git.hold = true;
    void fetchRefs({ cwd: '/a', refs: 'all' });
    void fetchRefs({ cwd: '/b', refs: 'all' });
    await flush();
    expect(git.log).toEqual(['start all@/a', 'start all@/b']);
    git.release[0](true);
    git.release[1](true);
  });

  it('keeps the line open after a fetch that failed', async () => {
    git.hold = true;
    const failed = fetchRefs({ cwd: '/a', refs: ['feat'] });
    const next = fetchRefs({ cwd: '/a', refs: ['main'] });
    await flush();
    git.release[0](false);
    expect(await failed).toBe(false);
    await flush();
    git.release[1](true);
    expect(await next).toBe(true);
  });

  it('reuses a recent fetch of the same refs when the caller allows it', async () => {
    await fetchRefs({ cwd: '/a', refs: ['feat', 'main'] });
    vi.advanceTimersByTime(60_000);
    // Same refs in another order, well inside the age allowed.
    expect(
      await fetchRefs({ cwd: '/a', refs: ['main', 'feat'], maxAgeMs: 300_000 })
    ).toBe(true);
    expect(git.log.filter((l) => l.startsWith('start'))).toHaveLength(1);

    vi.advanceTimersByTime(300_000);
    await fetchRefs({ cwd: '/a', refs: ['main', 'feat'], maxAgeMs: 300_000 });
    expect(git.log.filter((l) => l.startsWith('start'))).toHaveLength(2);
  });

  it('never lets a fetch of everything stand in for named refs, nor the reverse', async () => {
    // `git fetch --all` on a repository with no remote succeeds having
    // fetched nothing; a fetch of the branch would have failed, and the
    // merge check that follows must know which happened.
    await fetchRefs({ cwd: '/a', refs: 'all' });
    await fetchRefs({ cwd: '/a', refs: ['main', 'feat'], maxAgeMs: 300_000 });
    expect(git.log.filter((l) => l.startsWith('start'))).toHaveLength(2);

    __resetFetchQueueForTests();
    git.log = [];
    await fetchRefs({ cwd: '/a', refs: ['main', 'feat'] });
    await fetchRefs({ cwd: '/a', refs: 'all', maxAgeMs: 300_000 });
    expect(git.log.filter((l) => l.startsWith('start'))).toHaveLength(2);
  });

  it('never reuses across repositories, nor without an allowed age, nor a failure', async () => {
    await fetchRefs({ cwd: '/a', refs: ['feat'] });
    await fetchRefs({ cwd: '/b', refs: ['feat'], maxAgeMs: 300_000 });
    await fetchRefs({ cwd: '/a', refs: ['feat'] });
    expect(git.log.filter((l) => l.startsWith('start'))).toHaveLength(3);

    git.hold = true;
    const failed = fetchRefs({ cwd: '/c', refs: ['feat'] });
    await flush();
    git.release[0](false);
    await failed;
    git.hold = false;
    await fetchRefs({ cwd: '/c', refs: ['feat'], maxAgeMs: 300_000 });
    expect(git.log.filter((l) => l.startsWith('start feat@/c'))).toHaveLength(
      2
    );
  });
});
