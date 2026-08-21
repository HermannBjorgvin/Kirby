import { describe, it, expect, vi } from 'vitest';

// The module imports the session launcher (→ pty-registry → node-pty).
// Mock the registry so these stay fast, dependency-free unit tests.
vi.mock('../../pty-registry.js', () => ({
  spawnSession: vi.fn(),
  getSession: vi.fn(),
  hasSession: vi.fn(() => false),
}));

import { sessionMenuOptions } from './session-menu-input.js';

describe('sessionMenuOptions', () => {
  it('offers the full menu for PR items, start first', () => {
    expect(sessionMenuOptions(true)).toEqual([
      'start',
      'review',
      'instructions',
      'cancel',
    ]);
  });

  it('offers only start and cancel for plain sessions', () => {
    expect(sessionMenuOptions(false)).toEqual(['start', 'cancel']);
  });
});
