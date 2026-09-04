import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type * as BabysitModule from './babysit.js';

const state = vi.hoisted(() => ({
  cwd: '/repo',
  prs: [] as PullRequestInfo[],
  started: [] as {
    prId: number;
    cwd: string;
    stop: () => void;
    onStatus: (s: unknown) => void;
    onSpawned?: (name: string, cwd: string) => void;
    isCurrent: () => boolean;
  }[],
  adopted: [] as string[],
  stopped: [] as number[],
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => state.cwd,
  activeRepoIs: (cwd: string) => cwd === state.cwd,
}));
vi.mock('@kirby/vcs-core', () => ({
  readConfig: () => ({ vendorAuth: {}, vendorProject: {} }),
}));
vi.mock('./sidebar.js', () => ({
  repoProvider: () => null,
  lookupPullRequest: (_cwd: string, prId: number) => {
    const pr = state.prs.find((entry) => entry.id === prId);
    return Promise.resolve(pr ? { kind: 'found', pr } : { kind: 'gone' });
  },
}));
vi.mock('./sessions.js', () => ({
  adoptSpawnedSession: (name: string, branch: string) =>
    state.adopted.push(`${name}:${branch}`),
  defaultPaneSize: () => ({ cols: 120, rows: 40 }),
  isForeignSession: () => false,
}));
vi.mock('@kirby/core', () => ({
  startPrBabysitter: (opts: {
    pr: PullRequestInfo;
    cwd: string;
    onStatus: (s: unknown) => void;
    onSpawned?: (name: string, cwd: string) => void;
    isCurrent: () => boolean;
  }) => {
    const entry = {
      prId: opts.pr.id,
      cwd: opts.cwd,
      stop: () => state.stopped.push(opts.pr.id),
      onStatus: opts.onStatus,
      onSpawned: opts.onSpawned,
      isCurrent: opts.isCurrent,
    };
    state.started.push(entry);
    return {
      status: () => ({ prId: opts.pr.id, phase: 'watching' }),
      stop: entry.stop,
      pollNow: () => Promise.resolve(),
    };
  },
}));

const pr = (id: number): PullRequestInfo => ({
  id,
  title: `PR ${id}`,
  sourceBranch: `feat/${id}`,
  targetBranch: 'master',
  url: '',
  createdByIdentifier: 'me',
  createdByDisplayName: 'Me',
});

let mod: typeof BabysitModule;
const changes: unknown[] = [];

beforeEach(async () => {
  state.cwd = '/repo';
  state.prs = [pr(7), pr(8)];
  state.started.length = 0;
  state.adopted.length = 0;
  state.stopped.length = 0;
  changes.length = 0;
  vi.resetModules();
  mod = await import('./babysit.js');
  mod.setBabysitNotifier((event) => changes.push(event));
});

describe('babysit service', () => {
  it('starts one babysitter per pull request and lists it', async () => {
    await mod.startBabysit(7);
    await mod.startBabysit(7);
    expect(state.started.map((s) => s.prId)).toEqual([7]);
    // The repository is handed over at start: the host chdir()s when
    // another one is opened, and the watcher's git must not follow.
    expect(state.started[0].cwd).toBe('/repo');
    expect(mod.listBabysat().map((s) => s.prId)).toEqual([7]);
    expect(changes.length).toBe(1);
  });

  it('refuses a pull request the sidebar does not have', async () => {
    await expect(mod.startBabysit(99)).rejects.toThrow('#99');
    expect(mod.listBabysat()).toEqual([]);
  });

  it('stops and forgets, and tolerates stopping nothing', async () => {
    await mod.startBabysit(7);
    mod.stopBabysit(7);
    mod.stopBabysit(7);
    expect(state.stopped).toEqual([7]);
    expect(mod.listBabysat()).toEqual([]);
  });

  it('drops a babysitter that ended on its own and says which', async () => {
    await mod.startBabysit(7);
    state.started[0].onStatus({ prId: 7, phase: 'ended' });
    expect(mod.listBabysat()).toEqual([]);
    expect(changes.at(-1)).toEqual({
      ended: { prId: 7, sourceBranch: 'feat/7' },
    });
  });

  it('adopts a session the babysitter spawned, under the pull request branch', async () => {
    await mod.startBabysit(7);
    state.started[0].onSpawned?.('feat-7', '/wt/feat-7');
    expect(state.adopted).toEqual(['feat-7:feat/7']);
  });

  it('keeps babysitters per repository and sits out ticks while another is open', async () => {
    await mod.startBabysit(7);
    state.cwd = '/other';
    state.prs = [pr(7)];
    expect(mod.listBabysat()).toEqual([]);
    expect(state.started[0].isCurrent()).toBe(false);
    await mod.startBabysit(7);
    expect(state.started).toHaveLength(2);
    expect(state.started[1].cwd).toBe('/other');
    state.cwd = '/repo';
    expect(mod.listBabysat().map((s) => s.prId)).toEqual([7]);
    expect(state.started[0].isCurrent()).toBe(true);
  });

  it('stops every babysitter of every repository on exit', async () => {
    await mod.startBabysit(7);
    await mod.startBabysit(8);
    mod.stopAllBabysitters();
    expect(state.stopped.sort()).toEqual([7, 8]);
    expect(mod.listBabysat()).toEqual([]);
  });
});
