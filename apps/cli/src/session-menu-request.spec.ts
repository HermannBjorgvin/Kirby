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

  it('leaves the request pending for a non-matching mount', () => {
    requestSessionMenu('feature-x');
    expect(consumeSessionMenuRequest('other')).toBe(false);
    expect(consumeSessionMenuRequest(undefined)).toBe(false);
    expect(consumeSessionMenuRequest('feature-x')).toBe(true);
  });

  it('returns false with no pending request', () => {
    expect(consumeSessionMenuRequest('feature-x')).toBe(false);
  });

  it('a newer request replaces the old one', () => {
    requestSessionMenu('a');
    requestSessionMenu('b');
    expect(consumeSessionMenuRequest('a')).toBe(false);
    expect(consumeSessionMenuRequest('b')).toBe(true);
  });
});
