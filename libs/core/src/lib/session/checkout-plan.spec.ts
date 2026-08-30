import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig, PullRequestInfo } from '@kirby/vcs-core';

// Mock the launcher + registry so the orchestrator's branching is
// observable without spawning real processes.
const hasSession = vi.fn();
vi.mock('../pty-registry.js', () => ({
  hasSession: (n: string) => hasSession(n),
}));

const launchSession = vi.fn();
const deliverToRunningSession = vi.fn();
vi.mock('./launch-session.js', () => ({
  launchSession: (...a: unknown[]) => launchSession(...a),
  deliverToRunningSession: (...a: unknown[]) => deliverToRunningSession(...a),
}));

const branchToSessionName = vi.fn((b: string) => `sess-${b}`);
const createWorktree = vi.fn();
vi.mock('@kirby/worktree-manager', () => ({
  branchToSessionName: (b: string) => branchToSessionName(b),
  createWorktree: (b: string) => createWorktree(b),
}));

import { checkoutPlan } from './checkout-plan.js';

const pr = { id: 7, sourceBranch: 'feature/x' } as PullRequestInfo;
const config = { vendorAuth: {}, vendorProject: {} } as AppConfig;

function deps(mode: 'inject' | 'new-session', flashStatus = vi.fn()) {
  return {
    pr,
    prompt: 'Resolve these PR review comments:\n\n### 1. a.ts:1\n@a: b',
    paneCols: 80,
    paneRows: 24,
    mode,
    config,
    flashStatus,
  };
}

describe('checkoutPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createWorktree.mockResolvedValue('/wt/feature-x');
  });

  it('State A / inject: delivers to the running session, never spawns', async () => {
    hasSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(true);

    const result = await checkoutPlan(deps('inject'));

    expect(result).toBe('injected');
    expect(deliverToRunningSession).toHaveBeenCalledWith(
      'sess-feature/x',
      expect.stringContaining('Resolve these PR review comments')
    );
    expect(launchSession).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('State A / inject: fails when the session is no longer alive', async () => {
    hasSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(false);
    const flash = vi.fn();

    const result = await checkoutPlan(deps('inject', flash));

    expect(result).toBe('failed');
    expect(launchSession).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalled();
  });

  it('State A / new-session: respawns in the existing worktree with the seed intent', async () => {
    hasSession.mockReturnValue(true);

    const result = await checkoutPlan(deps('new-session'));

    expect(result).toBe('spawned');
    expect(createWorktree).toHaveBeenCalledWith('feature/x');
    expect(launchSession).toHaveBeenCalledTimes(1);
    const arg = launchSession.mock.calls[0][0];
    expect(arg.name).toBe('sess-feature/x');
    expect(arg.cwd).toBe('/wt/feature-x');
    // Must seed (deliver the plan), never continue.
    expect(arg.request).toEqual({
      intent: 'seed',
      prompt: expect.stringContaining('Resolve these PR review comments'),
    });
  });

  it('States B/C: no running agent → create worktree + spawn', async () => {
    hasSession.mockReturnValue(false);

    const result = await checkoutPlan(deps('new-session'));

    expect(result).toBe('spawned');
    expect(createWorktree).toHaveBeenCalledWith('feature/x');
    expect(launchSession).toHaveBeenCalledTimes(1);
    expect(launchSession.mock.calls[0][0].cwd).toBe('/wt/feature-x');
  });

  it('fails when the worktree cannot be created', async () => {
    hasSession.mockReturnValue(false);
    createWorktree.mockResolvedValue(null);
    const flash = vi.fn();

    const result = await checkoutPlan(deps('new-session', flash));

    expect(result).toBe('failed');
    expect(launchSession).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalled();
  });

  it('passes the prompt through verbatim — no quote stripping', async () => {
    hasSession.mockReturnValue(false);

    await checkoutPlan({ ...deps('new-session'), prompt: `it's "quoted"` });

    expect(launchSession.mock.calls[0][0].request.prompt).toBe(`it's "quoted"`);
  });
});
