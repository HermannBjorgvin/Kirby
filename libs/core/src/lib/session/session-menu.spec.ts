import { describe, it, expect } from 'vitest';
import {
  cycleAgentIndex,
  openSessionMenuState,
  sessionMenuOptions,
} from './session-menu.js';

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

describe('openSessionMenuState', () => {
  it('starts on the first row with the default agent', () => {
    expect(openSessionMenuState(undefined)).toEqual({
      pr: null,
      selectedOption: 0,
      agentIndex: 0,
    });
  });
});

describe('cycleAgentIndex', () => {
  it('wraps in both directions', () => {
    expect(cycleAgentIndex(0, 1, 3)).toBe(1);
    expect(cycleAgentIndex(2, 1, 3)).toBe(0);
    expect(cycleAgentIndex(0, -1, 3)).toBe(2);
  });

  it('is safe on an empty list', () => {
    expect(cycleAgentIndex(0, 1, 0)).toBe(0);
  });
});
