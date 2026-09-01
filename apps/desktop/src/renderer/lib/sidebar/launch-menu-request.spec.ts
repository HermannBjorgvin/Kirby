import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetLaunchMenuRequestForTests,
  clearLaunchMenuRequest,
  launchMenuOpen,
  pendingLaunchMenu,
  requestLaunchMenu,
  subscribeLaunchMenu,
} from './launch-menu-request.js';

beforeEach(() => {
  __resetLaunchMenuRequestForTests();
});

describe('launch menu request', () => {
  it('holds one request at a time, newest wins', () => {
    requestLaunchMenu('alpha');
    requestLaunchMenu('beta');
    expect(pendingLaunchMenu()).toBe('beta');
  });

  it('clears only the branch it is asked to clear', () => {
    requestLaunchMenu('alpha');
    clearLaunchMenuRequest('other');
    expect(pendingLaunchMenu()).toBe('alpha');
    clearLaunchMenuRequest('alpha');
    expect(pendingLaunchMenu()).toBeNull();
  });

  it('notifies subscribers on every change, and not after unsubscribe', () => {
    const cb = vi.fn();
    const off = subscribeLaunchMenu(cb);
    requestLaunchMenu('alpha');
    clearLaunchMenuRequest('alpha');
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    requestLaunchMenu('beta');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('does not notify for a clear that changes nothing', () => {
    const cb = vi.fn();
    subscribeLaunchMenu(cb);
    clearLaunchMenuRequest('alpha');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('launchMenuOpen', () => {
  it('opens from the tab itself regardless of the item', () => {
    expect(
      launchMenuOpen({
        own: true,
        requested: false,
        hasItem: false,
        running: true,
      })
    ).toBe(true);
  });

  it('honors a request once the item exists and its agent is idle', () => {
    const base = { own: false, requested: true, hasItem: true, running: false };
    expect(launchMenuOpen(base)).toBe(true);
    expect(launchMenuOpen({ ...base, hasItem: false })).toBe(false);
    expect(launchMenuOpen({ ...base, running: true })).toBe(false);
    expect(launchMenuOpen({ ...base, requested: false })).toBe(false);
  });
});
