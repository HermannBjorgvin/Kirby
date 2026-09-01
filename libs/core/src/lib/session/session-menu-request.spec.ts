import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SESSION_MENU_REQUEST_TTL_MS,
  __resetSessionMenuRequestForTests,
  consumeSessionMenuRequest,
  peekSessionMenuRequest,
  requestSessionMenu,
  subscribeSessionMenuRequest,
} from './session-menu-request.js';

beforeEach(() => {
  __resetSessionMenuRequestForTests();
});

describe('session menu request', () => {
  it('is consumed once by the session it names', () => {
    requestSessionMenu('alpha', 0);
    expect(peekSessionMenuRequest()).toBe('alpha');
    expect(consumeSessionMenuRequest('alpha', 1)).toBe(true);
    expect(consumeSessionMenuRequest('alpha', 2)).toBe(false);
    expect(peekSessionMenuRequest()).toBeNull();
  });

  it('is left in place for a pane showing another session', () => {
    requestSessionMenu('alpha', 0);
    expect(consumeSessionMenuRequest('beta', 1)).toBe(false);
    expect(consumeSessionMenuRequest(null, 1)).toBe(false);
    expect(peekSessionMenuRequest()).toBe('alpha');
  });

  it('is replaced by a newer request', () => {
    requestSessionMenu('alpha', 0);
    requestSessionMenu('beta', 1);
    expect(consumeSessionMenuRequest('alpha', 2)).toBe(false);
    expect(consumeSessionMenuRequest('beta', 2)).toBe(true);
  });

  it('expires instead of popping a menu long after it was filed', () => {
    requestSessionMenu('alpha', 0);
    expect(
      consumeSessionMenuRequest('alpha', SESSION_MENU_REQUEST_TTL_MS + 1)
    ).toBe(false);
    expect(peekSessionMenuRequest()).toBeNull();
  });

  it('notifies subscribers when filed and when consumed', () => {
    const cb = vi.fn();
    const off = subscribeSessionMenuRequest(cb);
    requestSessionMenu('alpha', 0);
    consumeSessionMenuRequest('alpha', 1);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    requestSessionMenu('beta', 2);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
