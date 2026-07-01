import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PullRequestInfo } from '@kirby/vcs-core';

// Mock the PTY registry and worktree manager so the orchestrator's
// branching is observable without spawning real processes.
const hasSession = vi.fn();
const getSession = vi.fn();
const spawnSession = vi.fn();
vi.mock('../pty-registry.js', () => ({
  hasSession: (n: string) => hasSession(n),
  getSession: (n: string) => getSession(n),
  spawnSession: (...a: unknown[]) => spawnSession(...a),
}));

const branchToSessionName = vi.fn((b: string) => `sess-${b}`);
const createWorktree = vi.fn();
vi.mock('@kirby/worktree-manager', () => ({
  branchToSessionName: (b: string) => branchToSessionName(b),
  createWorktree: (b: string) => createWorktree(b),
}));

import { checkoutPlan } from './checkout-orchestrator.js';

const pr = { id: 7, sourceBranch: 'feature/x' } as PullRequestInfo;

function deps(mode: 'inject' | 'new-session', flashStatus = vi.fn()) {
  return {
    pr,
    prompt: 'Resolve these PR review comments:\n\n### 1. a.ts:1\n@a: b',
    paneCols: 80,
    paneRows: 24,
    mode,
    flashStatus,
  };
}

describe('checkoutPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createWorktree.mockResolvedValue('/wt/feature-x');
  });

  it('State A / inject: writes to the running PTY, never spawns', async () => {
    hasSession.mockReturnValue(true);
    const write = vi.fn();
    getSession.mockReturnValue({ pty: { write }, exited: false });

    const result = await checkoutPlan(deps('inject'));

    expect(result).toBe('injected');
    expect(write).toHaveBeenCalledTimes(1);
    // Prompt is submitted with a trailing carriage return, no shell-quoting.
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/\r$/));
    expect(spawnSession).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('State A / inject: fails when the session has exited', async () => {
    hasSession.mockReturnValue(true);
    getSession.mockReturnValue({ pty: { write: vi.fn() }, exited: true });
    const flash = vi.fn();

    const result = await checkoutPlan(deps('inject', flash));

    expect(result).toBe('failed');
    expect(spawnSession).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalled();
  });

  it('State A / new-session: respawns in the existing worktree', async () => {
    hasSession.mockReturnValue(true);

    const result = await checkoutPlan(deps('new-session'));

    expect(result).toBe('spawned');
    expect(createWorktree).toHaveBeenCalledWith('feature/x');
    expect(spawnSession).toHaveBeenCalledTimes(1);
    const args = spawnSession.mock.calls[0];
    expect(args[0]).toBe('sess-feature/x');
    // Seed command must NOT use --continue (else the plan is swallowed).
    expect(args[2][1]).not.toContain('--continue');
    expect(args[2][1]).toContain("claude '");
  });

  it('States B/C: no running agent → create worktree + spawn', async () => {
    hasSession.mockReturnValue(false);

    const result = await checkoutPlan(deps('new-session'));

    expect(result).toBe('spawned');
    expect(createWorktree).toHaveBeenCalledWith('feature/x');
    expect(spawnSession).toHaveBeenCalledTimes(1);
    expect(spawnSession.mock.calls[0][5]).toBe('/wt/feature-x');
  });

  it('fails when the worktree cannot be created', async () => {
    hasSession.mockReturnValue(false);
    createWorktree.mockResolvedValue(null);
    const flash = vi.fn();

    const result = await checkoutPlan(deps('new-session', flash));

    expect(result).toBe('failed');
    expect(spawnSession).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalled();
  });

  it('sanitizes quotes in the seed command', async () => {
    hasSession.mockReturnValue(false);

    await checkoutPlan({ ...deps('new-session'), prompt: `it's "quoted"` });

    const cmd = spawnSession.mock.calls[0][2][1] as string;
    expect(cmd).not.toContain('"');
    expect(cmd).toBe("claude 'its quoted'");
  });
});
