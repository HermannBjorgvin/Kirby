import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaggedSession } from '../session-identity.js';
const state = vi.hoisted(() => ({
  existing: null as TaggedSession | null,
  create: vi.fn<(spec: unknown, plan: unknown) => { name: string }>(() => ({
    name: 'allocated',
  })),
  register: vi.fn(),
  head: vi.fn(),
  held: vi.fn(() => false),
}));
vi.mock('@kirby/terminal-tmux', () => ({ createTmuxBackend: state.create }));
vi.mock('../pty-registry.js', () => ({
  spawnSession: state.register,
  sessionNames: () => [],
}));
vi.mock('../session-resolver.js', () => ({
  resolveSessionByName: () => state.existing,
  resolveWorktreeSession: () => state.existing,
}));
vi.mock('../discovery/worktree-origin.js', () => ({
  readWorktreeHead: state.head,
}));
import { openSession, type OpenSessionParams } from './open-session.js';
const build = vi.fn(() => ({
  spec: { cmd: 'codex', args: [] },
  agent: 'codex',
}));
const base: OpenSessionParams = {
  session: { type: 'worktree', repo: '/repo', branch: 'feature/x' },
  cwd: '/repo/worktree',
  cols: 80,
  rows: 24,
  build,
};
const found: TaggedSession = {
  name: 'unrelated-label',
  repo: '/repo',
  branch: 'feature/x',
  path: base.cwd,
  type: 'worktree',
  spawner: 'orchestra',
  agent: 'claude',
  created: 1,
  paneDead: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.existing = null;
  state.head.mockReturnValue({ branch: 'feature/x' });
});
describe('session launch boundary', () => {
  it('coalesces concurrent requests for the same worktree', async () => {
    await Promise.all([openSession(base), openSession(base)]);
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.register).toHaveBeenCalledOnce();
  });
  it('attaches a running session without constructing any agent command', async () => {
    state.existing = found;
    await openSession(base);
    expect(build).not.toHaveBeenCalled();
    expect(state.create.mock.calls[0][1]).toEqual({
      mode: 'attach',
      target: found.name,
    });
    expect(state.register).toHaveBeenCalledWith(
      '["worktree","/repo","feature/x"]',
      expect.anything(),
      80,
      24,
      'claude'
    );
  });
  it('attaches an exited pane for discovery without restarting it', async () => {
    state.existing = { ...found, paneDead: true };
    await openSession({ ...base, mode: 'attach' });
    expect(build).not.toHaveBeenCalled();
    expect(state.create.mock.calls[0][1]).toMatchObject({ mode: 'attach' });
  });
  it('restarts an exited agent with its recorded identity and preserves creator tags', async () => {
    state.existing = { ...found, paneDead: true };
    await openSession(base);
    expect(build).toHaveBeenCalledWith('claude', true);
    expect(state.create.mock.calls[0][1]).toEqual({
      mode: 'restart',
      target: found.name,
      tags: { '@orchestra-agent': 'codex' },
      retainOnExit: true,
    });
  });
  it('records identity and the actual selected agent on creation', async () => {
    await openSession(base);
    expect(state.create.mock.calls[0][1]).toMatchObject({
      mode: 'create',
      tags: {
        '@orchestra-repo': '/repo',
        '@orchestra-branch': 'feature/x',
        '@orchestra-agent': 'codex',
      },
      retainOnExit: true,
    });
  });
  it('fails a vanished attach instead of launching a replacement', async () => {
    await expect(openSession({ ...base, mode: 'attach' })).rejects.toThrow(
      'ended'
    );
    expect(build).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
  it('rejects the wrong checkout before touching an existing connection', async () => {
    state.head.mockReturnValue({ branch: 'other' });
    await expect(openSession(base)).rejects.toThrow('other');
    expect(state.create).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  });
});
