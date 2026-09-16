import { beforeEach, expect, it, vi } from 'vitest';
import { worktreeSessionKey } from '../session-key.js';

const state = vi.hoisted(() => ({
  heldTarget: 'held',
  targets: ['held', 'duplicate'] as string[],
}));
vi.mock('../pty-registry.js', () => ({
  hasSession: () => state.heldTarget !== '',
  killSession: () => {
    state.targets = state.targets.filter((name) => name !== state.heldTarget);
    state.heldTarget = '';
  },
}));
vi.mock('../session-backend.js', () => ({
  // Both targets advertise the same worktree identity. Resolution selects the
  // oldest survivor, just like the production tagged-session resolver.
  killPersistedTmuxSession: () => state.targets.shift(),
}));
import { stopSession } from './stop-session.js';

beforeEach(() => {
  state.heldTarget = 'held';
  state.targets = ['held', 'duplicate'];
});

it('stops the held target without resolving and killing a second matching session', () => {
  stopSession(worktreeSessionKey('feature', '/repo'));
  expect(state.targets).toEqual(['duplicate']);
  expect(state.heldTarget).toBe('');
});

it('stops the selected persisted target when there is no held entry', () => {
  state.heldTarget = '';
  stopSession(worktreeSessionKey('feature', '/repo'));
  expect(state.targets).toEqual(['duplicate']);
});
