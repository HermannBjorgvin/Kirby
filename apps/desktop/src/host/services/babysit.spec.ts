import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type * as BabysitModule from './babysit.js';

const state = vi.hoisted(() => ({
  cwd: '/repo',
  prs: [] as PullRequestInfo[],
  started: [] as {
    prId: number;
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
  findPullRequest: (_cwd: string, prId: number) =>
    Promise.resolve(state.prs.find((pr) => pr.id === prId) ?? null),
}));
vi.mock('./sessions.js', () => ({
  adoptSpawnedSession: (name: string, branch: string) =>
    state.adopted.push(`${name}:${branch}`),
  defaultPaneSize: () => ({ cols: 120, rows: 40 }),
}));
vi.mock('@kirby/core', () => ({
  startPrBabysitter: (opts: {
    pr: PullRequestInfo;
    onStatus: (s: unknown) => void;
    onSpawned?: (name: string, cwd: string) => void;
    isCurrent: () => boolean;
  }) => {
    const entry = {
      prId: opts.pr.id,
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
const changes: number[] = [];

beforeEach(async () => {
  state.cwd = '/repo';
  state.prs = [pr(7), pr(8)];
  state.started.length = 0;
  state.adopted.length = 0;
  state.stopped.length = 0;
  changes.length = 0;
  vi.resetModules();
  mod = await import('./babysit.js');
  mod.setBabysitNotifier(() => changes.push(1));
});

describe('babysit service', () => {
  it('starts one babysitter per pull request and lists it', async () => {
    await mod.startBabysit(7);
    await mod.startBabysit(7);
    expect(state.started.map((s) => s.prId)).toEqual([7]);
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

  it('drops a babysitter that ended on its own', async () => {
    await mod.startBabysit(7);
    state.started[0].onStatus({ prId: 7, phase: 'ended' });
    expect(mod.listBabysat()).toEqual([]);
    expect(changes.length).toBe(2);
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
