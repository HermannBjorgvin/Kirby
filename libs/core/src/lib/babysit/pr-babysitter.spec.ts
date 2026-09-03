import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  AppConfig,
  PullRequestComments,
  PullRequestInfo,
  VcsProvider,
} from '@kirby/vcs-core';
import type { BabysitStatus } from './pr-babysitter.js';

const mocks = vi.hoisted(() => ({
  countRemoteConflicts: vi.fn<() => Promise<number | null>>(),
  createWorktree: vi.fn<() => Promise<string | null>>(),
  isSessionAlive: vi.fn<() => boolean>(),
  snapshot: vi.fn<() => { active: boolean; flashing: boolean }>(),
  deliverToRunningSession: vi.fn<(name: string, prompt: string) => boolean>(),
  launchSession: vi.fn(),
}));

vi.mock('@kirby/logger', () => ({ logError: () => undefined }));
vi.mock('@kirby/worktree-manager', () => ({
  branchToSessionName: (b: string) => b.replace(/\//g, '-'),
  countRemoteConflicts: () => mocks.countRemoteConflicts(),
  createWorktree: () => mocks.createWorktree(),
}));
vi.mock('../pty-registry.js', () => ({
  isSessionAlive: () => mocks.isSessionAlive(),
}));
vi.mock('../activity.js', () => ({ snapshot: () => mocks.snapshot() }));
vi.mock('../session/launch-session.js', () => ({
  deliverToRunningSession: (name: string, prompt: string) =>
    mocks.deliverToRunningSession(name, prompt),
  launchSession: (params: unknown) => mocks.launchSession(params),
}));

const { startPrBabysitter, observePullRequest } = await import(
  './pr-babysitter.js'
);

const MIN = 60_000;

const pr: PullRequestInfo = {
  id: 7,
  title: 'Add thing',
  sourceBranch: 'feat/thing',
  targetBranch: 'master',
  url: 'https://x/7',
  createdByIdentifier: 'me',
  createdByDisplayName: 'Me',
  buildStatus: 'succeeded',
};

const config = {
  vendorAuth: {},
  vendorProject: { username: 'me' },
} as AppConfig;

function providerWith(comments: PullRequestComments): VcsProvider {
  return {
    matchesUser: (id: string) => id === 'me',
    fetchCommentThreads: () => Promise.resolve(comments),
  } as unknown as VcsProvider;
}

const noComments: PullRequestComments = { threads: [], generalComments: [] };

const aliceThread = {
  id: 't1',
  file: 'a.ts',
  lineStart: 1,
  lineEnd: 1,
  side: 'RIGHT' as const,
  isResolved: false,
  isOutdated: false,
  canResolve: true,
  comments: [{ id: 'c', author: 'alice', body: 'fix', createdAt: '' }],
};

describe('observePullRequest', () => {
  it('keeps unresolved inline and general threads, drops resolved ones', async () => {
    mocks.countRemoteConflicts.mockResolvedValue(2);
    const provider = providerWith({
      threads: [aliceThread, { ...aliceThread, id: 't2', isResolved: true }],
      generalComments: [
        { ...aliceThread, id: 'g1', file: null, lineStart: null },
      ],
    });
    const observation = await observePullRequest(pr, provider, config);
    expect(observation.threads.map((t) => t.id)).toEqual(['t1', 'g1']);
    expect(observation).toMatchObject({
      buildStatus: 'succeeded',
      conflictCount: 2,
    });
  });

  it('observes without a provider', async () => {
    mocks.countRemoteConflicts.mockResolvedValue(0);
    const observation = await observePullRequest(pr, null, config);
    expect(observation.threads).toEqual([]);
  });
});

describe('startPrBabysitter', () => {
  let clock = 0;
  const statuses: BabysitStatus[] = [];
  let readPullRequest: () => Promise<PullRequestInfo | null>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clock = 0;
    statuses.length = 0;
    mocks.countRemoteConflicts.mockResolvedValue(0);
    mocks.createWorktree.mockResolvedValue('/wt/feat-thing');
    mocks.isSessionAlive.mockReturnValue(true);
    mocks.snapshot.mockReturnValue({ active: false, flashing: false });
    mocks.deliverToRunningSession.mockReturnValue(true);
    readPullRequest = () => Promise.resolve({ ...pr, buildStatus: 'failed' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function start(over: Partial<Parameters<typeof startPrBabysitter>[0]> = {}) {
    return startPrBabysitter({
      pr,
      provider: providerWith(noComments),
      getConfig: () => config,
      readPullRequest: () => readPullRequest(),
      paneSize: () => ({ cols: 100, rows: 30 }),
      onStatus: (s) => statuses.push(s),
      now: () => clock,
      intervalMs: MIN,
      ...over,
    });
  }

  it('waits out the debounce before typing the update into an idle agent', async () => {
    const sitter = start();
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({
      phase: 'pending',
      pendingSince: 0,
    });
    expect(mocks.deliverToRunningSession).not.toHaveBeenCalled();

    clock = 10 * MIN;
    await sitter.pollNow();
    expect(mocks.deliverToRunningSession).toHaveBeenCalledWith(
      'feat-thing',
      expect.stringContaining('CI: failed')
    );
    expect(statuses.at(-1)).toMatchObject({
      phase: 'watching',
      deliveries: 1,
      lastDeliveredAt: 10 * MIN,
    });
    sitter.stop();
  });

  it('holds the update while the agent is producing output', async () => {
    mocks.snapshot.mockReturnValue({ active: true, flashing: false });
    const sitter = start();
    await sitter.pollNow();
    clock = 10 * MIN;
    await sitter.pollNow();
    expect(mocks.deliverToRunningSession).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.phase).toBe('pending');

    mocks.snapshot.mockReturnValue({ active: false, flashing: false });
    clock = 11 * MIN;
    await sitter.pollNow();
    expect(mocks.deliverToRunningSession).toHaveBeenCalledTimes(1);
    sitter.stop();
  });

  it('starts an agent in the worktree when none is running', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    const spawned: string[] = [];
    const sitter = start({
      onSpawned: (name, cwd) => spawned.push(`${name}@${cwd}`),
    });
    await sitter.pollNow();
    clock = 10 * MIN;
    await sitter.pollNow();
    expect(mocks.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'feat-thing',
        cwd: '/wt/feat-thing',
        cols: 100,
        rows: 30,
        request: expect.objectContaining({ intent: 'continue-or-seed' }),
      })
    );
    expect(spawned).toEqual(['feat-thing@/wt/feat-thing']);
    sitter.stop();
  });

  it('ends when the pull request is gone', async () => {
    readPullRequest = () => Promise.resolve(null);
    const sitter = start();
    await sitter.pollNow();
    expect(statuses.at(-1)?.phase).toBe('ended');
    readPullRequest = () => Promise.resolve(pr);
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(statuses.filter((s) => s.phase === 'ended')).toHaveLength(1);
  });

  it('skips a poll that fails and reports the error', async () => {
    readPullRequest = () => Promise.reject(new Error('gh: rate limited'));
    const sitter = start();
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({
      lastError: 'gh: rate limited',
      lastPolledAt: null,
    });
    sitter.stop();
  });

  it('does nothing while the repository is not the open one', async () => {
    const sitter = start({ isCurrent: () => false });
    await sitter.pollNow();
    expect(statuses).toEqual([]);
    sitter.stop();
  });

  it('polls on its own on the interval and stops when told', async () => {
    const sitter = start();
    await vi.advanceTimersByTimeAsync(MIN + 1);
    const polls = statuses.length;
    expect(polls).toBeGreaterThanOrEqual(2);
    sitter.stop();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(statuses.length).toBe(polls);
  });
});
