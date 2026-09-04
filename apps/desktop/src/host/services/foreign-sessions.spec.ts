import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Module from './foreign-sessions.js';

/**
 * The host's answer to "which agents run elsewhere?": every live
 * worktree session except the open repository's own, each with its
 * repository put on the list so its tab can open it.
 */

const state = vi.hoisted(() => ({
  open: '/repos/alpha',
  live: [] as {
    tmuxName: string;
    path: string;
    repoRoot: string;
    branch: string;
    sessionName: string;
  }[],
  realpaths: {} as Record<string, string>,
  recents: [] as string[],
  configFor: [] as string[],
}));

vi.mock('node:fs', () => ({
  realpathSync: (p: string) => state.realpaths[p] ?? p,
}));
vi.mock('@kirby/core', () => ({
  listLiveWorktreeSessions: () => state.live,
}));
vi.mock('@kirby/vcs-core', () => ({
  readConfig: (cwd: string) => {
    state.configFor.push(cwd);
    return {};
  },
}));
vi.mock('./repo.js', () => ({
  requireRepo: () => state.open,
}));
vi.mock('./recent-repos.js', () => ({
  ensureRecent: (cwd: string) => {
    if (!state.recents.includes(cwd)) state.recents.push(cwd);
  },
}));

let foreign: typeof Module;

const ALPHA_AGENT = {
  tmuxName: 'kirby-aaaa-feat-a',
  path: '/repos/alpha/.claude/worktrees/feat-a',
  repoRoot: '/repos/alpha',
  branch: 'feat-a',
  sessionName: 'feat-a',
};
const BETA_AGENT = {
  tmuxName: 'kirby-bbbb-feat-b',
  path: '/repos/beta/.claude/worktrees/feat-b',
  repoRoot: '/repos/beta',
  branch: 'feat/b',
  sessionName: 'feat-b',
};

beforeEach(async () => {
  state.open = '/repos/alpha';
  state.live = [];
  state.realpaths = {};
  state.recents = [];
  state.configFor = [];
  vi.resetModules();
  foreign = await import('./foreign-sessions.js');
});

describe('listForeignSessions', () => {
  it('lists agents of other repositories, and not the open one’s', () => {
    state.live = [ALPHA_AGENT, BETA_AGENT];
    expect(foreign.listForeignSessions()).toEqual([
      { repo: '/repos/beta', branch: 'feat/b', sessionName: 'feat-b' },
    ]);
  });

  it('puts each foreign repository on the repo list', () => {
    state.live = [ALPHA_AGENT, BETA_AGENT];
    foreign.listForeignSessions();
    expect(state.recents).toEqual(['/repos/beta']);
  });

  // The core answers with real paths; a repository opened through a
  // symlink must still recognise its own agents rather than list them
  // as foreign — and then open them a second time on switching.
  it('recognises the open repository through a symlink', () => {
    state.open = '/home/dev/link-to-alpha';
    state.realpaths['/home/dev/link-to-alpha'] = '/repos/alpha';
    state.live = [ALPHA_AGENT];
    expect(foreign.listForeignSessions()).toEqual([]);
  });

  // The backend gate is the open repository's config, as it is for
  // discovery — documented, and pinned so it cannot drift quietly.
  it('reads the backend from the open repository’s config', () => {
    foreign.listForeignSessions();
    expect(state.configFor).toEqual(['/repos/alpha']);
  });
});
