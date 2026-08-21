import { describe, it, expect, beforeEach } from 'vitest';
import {
  requestSessionMenu,
  consumeSessionMenuRequest,
  __resetForTests,
} from './session-menu-request.js';

describe('session-menu-request', () => {
  beforeEach(() => __resetForTests());

  it('consumes a matching request exactly once', () => {
    requestSessionMenu('feature-x');
    expect(consumeSessionMenuRequest('feature-x')).toBe(true);
    expect(consumeSessionMenuRequest('feature-x')).toBe(false);
  });

  it('a non-matching mount discards the request instead of leaving it armed', () => {
    requestSessionMenu('feature-x');
    expect(consumeSessionMenuRequest('other')).toBe(false);
    // The request must not survive to pop the menu on a later visit.
    expect(consumeSessionMenuRequest('feature-x')).toBe(false);
  });

  it('returns false with no pending request', () => {
    expect(consumeSessionMenuRequest('feature-x')).toBe(false);
  });

  it('a newer request replaces the old one', () => {
    requestSessionMenu('a');
    requestSessionMenu('b');
    expect(consumeSessionMenuRequest('b')).toBe(true);
  });
});
