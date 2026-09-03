import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  AppConfig,
  PullRequestComments,
  PullRequestInfo,
  VcsProvider,
} from '@kirby/vcs-core';
import type { BabysitStatus, PullRequestLookup } from './pr-babysitter.js';

const mocks = vi.hoisted(() => ({
  fetchBranches: vi.fn<() => Promise<boolean>>(),
  countConflictsBetween: vi.fn<() => Promise<number | null>>(),
  refExists: vi.fn<(ref: string) => Promise<boolean>>(),
  createWorktree: vi.fn<() => Promise<string | null>>(),
  isSessionAlive: vi.fn<() => boolean>(),
  idleFor: vi.fn<() => number>(),
  deliverToRunningSession: vi.fn<(name: string, prompt: string) => boolean>(),
  launchSession: vi.fn(),
}));

vi.mock('@kirby/logger', () => ({ logError: () => undefined }));
vi.mock('@kirby/worktree-manager', () => ({
  branchToSessionName: (b: string) => b.replace(/\//g, '-'),
  fetchBranches: () => mocks.fetchBranches(),
  countConflictsBetween: () => mocks.countConflictsBetween(),
  refExists: (ref: string) => mocks.refExists(ref),
  createWorktree: () => mocks.createWorktree(),
}));
vi.mock('../pty-registry.js', () => ({
  isSessionAlive: () => mocks.isSessionAlive(),
}));
vi.mock('../activity.js', () => ({ idleFor: () => mocks.idleFor() }));
vi.mock('../session/launch-session.js', () => ({
  deliverToRunningSession: (name: string, prompt: string) =>
    mocks.deliverToRunningSession(name, prompt),
  launchSession: (params: unknown) => mocks.launchSession(params),
}));

const { startPrBabysitter } = await import('./pr-babysitter.js');
const { observePullRequest } = await import('./babysit-observe.js');

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
  headSha: 'abc',
};

const config = {
  vendorAuth: {},
  vendorProject: { username: 'me' },
} as AppConfig;

function providerWith(comments: PullRequestComments): VcsProvider {
  return {
    matchesUser: (id: string) => id === 'me',
    fetchCommentThreads: vi.fn(() => Promise.resolve(comments)),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchBranches.mockResolvedValue(true);
    mocks.countConflictsBetween.mockResolvedValue(2);
  });

  it('keeps unresolved inline and general threads, drops resolved ones', async () => {
    const provider = providerWith({
      threads: [aliceThread, { ...aliceThread, id: 't2', isResolved: true }],
      generalComments: [
        { ...aliceThread, id: 'g1', file: null, lineStart: null },
      ],
    });
    const { observation } = await observePullRequest(
      pr,
      provider,
      config,
      null,
      0
    );
    expect(observation.threads.map((t) => t.id)).toEqual(['t1', 'g1']);
    expect(observation).toMatchObject({
      buildStatus: 'succeeded',
      headSha: 'abc',
      conflictCount: 2,
    });
  });

  it('reports the conflict check as not run when the fetch failed', async () => {
    mocks.fetchBranches.mockResolvedValue(false);
    const { observation } = await observePullRequest(pr, null, config, null, 0);
    expect(observation.conflictCount).toBeNull();
    expect(mocks.countConflictsBetween).not.toHaveBeenCalled();
  });

  it('reuses the thread list and skips the fetch until the refresh is due', async () => {
    const provider = providerWith({
      threads: [aliceThread],
      generalComments: [],
    });
    const first = await observePullRequest(pr, provider, config, null, 0);
    const second = await observePullRequest(
      pr,
      provider,
      config,
      first.remote,
      MIN
    );
    expect(second.observation.threads).toBe(first.observation.threads);
    expect(provider.fetchCommentThreads).toHaveBeenCalledTimes(1);
    expect(mocks.fetchBranches).toHaveBeenCalledTimes(1);
    // The merge check itself still runs against the tracking refs.
    expect(mocks.countConflictsBetween).toHaveBeenCalledTimes(2);
  });

  it('reads again early when the list shows the count or the head moved', async () => {
    const provider = providerWith(noComments);
    const first = await observePullRequest(pr, provider, config, null, 0);
    await observePullRequest(
      { ...pr, activeCommentCount: 1 },
      provider,
      config,
      first.remote,
      MIN
    );
    await observePullRequest(
      { ...pr, headSha: 'def' },
      provider,
      config,
      first.remote,
      MIN
    );
    expect(provider.fetchCommentThreads).toHaveBeenCalledTimes(3);
  });

  it('reads again once the refresh interval has passed', async () => {
    const provider = providerWith(noComments);
    const first = await observePullRequest(pr, provider, config, null, 0);
    await observePullRequest(pr, provider, config, first.remote, 5 * MIN);
    expect(provider.fetchCommentThreads).toHaveBeenCalledTimes(2);
  });
});

describe('startPrBabysitter', () => {
  let clock = 0;
  const statuses: BabysitStatus[] = [];
  let lookup: () => Promise<PullRequestLookup>;
  const failing = { ...pr, buildStatus: 'failed' as const };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clock = 0;
    statuses.length = 0;
    mocks.fetchBranches.mockResolvedValue(true);
    mocks.countConflictsBetween.mockResolvedValue(0);
    mocks.refExists.mockResolvedValue(true);
    mocks.createWorktree.mockResolvedValue('/wt/feat-thing');
    mocks.isSessionAlive.mockReturnValue(true);
    mocks.idleFor.mockReturnValue(60_000);
    mocks.deliverToRunningSession.mockReturnValue(true);
    lookup = () => Promise.resolve({ kind: 'found', pr: failing });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function start(over: Partial<Parameters<typeof startPrBabysitter>[0]> = {}) {
    return startPrBabysitter({
      pr,
      provider: providerWith(noComments),
      getConfig: () => config,
      readPullRequest: () => lookup(),
      paneSize: () => ({ cols: 100, rows: 30 }),
      onStatus: (s) => statuses.push(s),
      now: () => clock,
      intervalMs: MIN,
      ...over,
    });
  }

  /** Poll once at t=0 and once past the debounce. */
  async function pollPastDebounce(sitter: { pollNow: () => Promise<void> }) {
    await sitter.pollNow();
    clock = 10 * MIN;
    await sitter.pollNow();
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
      held: null,
      deliveries: 1,
      lastDeliveredAt: 10 * MIN,
    });
    sitter.stop();
  });

  it('holds the update while the agent has produced output recently', async () => {
    mocks.idleFor.mockReturnValue(5_000);
    const sitter = start();
    await pollPastDebounce(sitter);
    expect(mocks.deliverToRunningSession).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({
      phase: 'pending',
      held: 'agent-busy',
    });

    mocks.idleFor.mockReturnValue(60_000);
    clock = 11 * MIN;
    await sitter.pollNow();
    expect(mocks.deliverToRunningSession).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)?.held).toBeNull();
    sitter.stop();
  });

  it('never types into a session that belongs to another repository', async () => {
    const sitter = start({
      isForeignSession: (name) => name === 'feat-thing',
    });
    await pollPastDebounce(sitter);
    expect(mocks.deliverToRunningSession).not.toHaveBeenCalled();
    expect(mocks.launchSession).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.held).toBe('foreign-session');
    sitter.stop();
  });

  it('starts an agent seeded with the update when none is running', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    const spawned: string[] = [];
    const sitter = start({
      onSpawned: (name, cwd) => spawned.push(`${name}@${cwd}`),
    });
    await pollPastDebounce(sitter);
    expect(mocks.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'feat-thing',
        cwd: '/wt/feat-thing',
        cols: 100,
        rows: 30,
        request: {
          intent: 'seed',
          prompt: expect.stringContaining('Status update for PR #7'),
        },
      })
    );
    expect(spawned).toEqual(['feat-thing@/wt/feat-thing']);
    expect(statuses.at(-1)?.deliveries).toBe(1);
    sitter.stop();
  });

  it('does not invent a branch that exists neither locally nor on origin', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    mocks.refExists.mockResolvedValue(false);
    const sitter = start();
    await pollPastDebounce(sitter);
    expect(mocks.createWorktree).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.held).toBe('branch-unavailable');
    sitter.stop();
  });

  it('keeps the update pending when delivery fails', async () => {
    mocks.deliverToRunningSession.mockReturnValue(false);
    const sitter = start();
    await pollPastDebounce(sitter);
    expect(statuses.at(-1)).toMatchObject({
      phase: 'pending',
      deliveries: 0,
      lastError: 'The agent exited while being briefed',
    });
    mocks.deliverToRunningSession.mockReturnValue(true);
    clock = 11 * MIN;
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({ deliveries: 1, lastError: null });
    sitter.stop();
  });

  it('does not spawn when the repo moved during the checkout', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    let current = true;
    const sitter = start({ isCurrent: () => current });
    mocks.createWorktree.mockImplementation(() => {
      current = false;
      return Promise.resolve('/wt/feat-thing');
    });
    await pollPastDebounce(sitter);
    expect(mocks.launchSession).not.toHaveBeenCalled();
    sitter.stop();
  });

  it('abandons a poll when the repository changes between its steps', async () => {
    let current = true;
    lookup = () => {
      current = false;
      return Promise.resolve({ kind: 'found', pr: failing });
    };
    const sitter = start({ isCurrent: () => current });
    await sitter.pollNow();
    expect(mocks.fetchBranches).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
    sitter.stop();
  });

  it('ends when the pull request is gone, but not when the provider could not say', async () => {
    lookup = () => Promise.resolve({ kind: 'unknown', reason: 'offline' });
    const sitter = start();
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({
      phase: 'watching',
      lastError: 'offline',
    });

    lookup = () => Promise.resolve({ kind: 'gone' });
    await sitter.pollNow();
    expect(statuses.at(-1)?.phase).toBe('ended');
    lookup = () => Promise.resolve({ kind: 'found', pr });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(statuses.filter((s) => s.phase === 'ended')).toHaveLength(1);
  });

  it('skips a poll that throws and reports the error', async () => {
    lookup = () => Promise.reject(new Error('gh: rate limited'));
    const sitter = start();
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({
      lastError: 'gh: rate limited',
      lastPolledAt: null,
    });
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
