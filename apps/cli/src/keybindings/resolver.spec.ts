import { describe, it, expect } from 'vitest';
import type { Key } from 'ink';
import {
  matchesKey,
  resolveAction,
  findConflict,
  descriptorFromKeypress,
} from './resolver.js';
import type { KeyDescriptor, ActionDef } from './registry.js';

// ── Helper to build a minimal Key object ──────────────────────────

function makeKey(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    tab: false,
    backspace: false,
    delete: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    ctrl: false,
    shift: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

// ── matchesKey ────────────────────────────────────────────────────

describe('matchesKey', () => {
  it('matches a plain character', () => {
    const desc: KeyDescriptor = { input: 'j' };
    expect(matchesKey(desc, 'j', makeKey())).toBe(true);
  });

  it('rejects wrong character', () => {
    const desc: KeyDescriptor = { input: 'j' };
    expect(matchesKey(desc, 'k', makeKey())).toBe(false);
  });

  it('matches a flag-only descriptor (downArrow)', () => {
    const desc: KeyDescriptor = { flags: { downArrow: true } };
    expect(matchesKey(desc, '', makeKey({ downArrow: true }))).toBe(true);
  });

  it('rejects flag mismatch', () => {
    const desc: KeyDescriptor = { flags: { downArrow: true } };
    expect(matchesKey(desc, '', makeKey({ upArrow: true }))).toBe(false);
  });

  it('uppercase letter matches despite Ink auto-shift', () => {
    // Ink sets key.shift=true for uppercase letters
    const desc: KeyDescriptor = { input: 'K' };
    expect(matchesKey(desc, 'K', makeKey({ shift: true }))).toBe(true);
  });

  it('plain downArrow does NOT match Shift+Down', () => {
    const desc: KeyDescriptor = { flags: { downArrow: true } };
    expect(
      matchesKey(desc, '', makeKey({ downArrow: true, shift: true }))
    ).toBe(false);
  });

  it('Shift+Down descriptor matches Shift+Down keypress', () => {
    const desc: KeyDescriptor = { shift: true, flags: { downArrow: true } };
    expect(
      matchesKey(desc, '', makeKey({ downArrow: true, shift: true }))
    ).toBe(true);
  });

  it('plain j does NOT match Ctrl+j', () => {
    const desc: KeyDescriptor = { input: 'j' };
    expect(matchesKey(desc, 'j', makeKey({ ctrl: true }))).toBe(false);
  });

  it('Ctrl+f descriptor matches Ctrl+f keypress', () => {
    const desc: KeyDescriptor = { input: 'f', ctrl: true };
    expect(matchesKey(desc, 'f', makeKey({ ctrl: true }))).toBe(true);
  });

  it('Escape matches despite Ink auto-meta', () => {
    // Ink sets key.meta=true for Escape (\x1b)
    const desc: KeyDescriptor = { flags: { escape: true } };
    expect(matchesKey(desc, '', makeKey({ escape: true, meta: true }))).toBe(
      true
    );
  });

  it('empty descriptor never matches', () => {
    const desc: KeyDescriptor = {};
    expect(matchesKey(desc, 'a', makeKey())).toBe(false);
  });
});

// ── resolveAction ────────────────────────────────────────────────

describe('resolveAction', () => {
  const actions: ActionDef[] = [
    { id: 'test.down', label: 'Down', context: 'sidebar' },
    { id: 'test.quit', label: 'Quit', context: 'sidebar' },
    { id: 'other.down', label: 'Down', context: 'settings' },
  ];

  const bindings: Record<string, KeyDescriptor[]> = {
    'test.down': [{ input: 'j' }, { flags: { downArrow: true } }],
    'test.quit': [{ input: 'q' }],
    'other.down': [{ input: 'j' }],
  };

  it('resolves to first matching action in context', () => {
    expect(resolveAction('j', makeKey(), 'sidebar', bindings, actions)).toBe(
      'test.down'
    );
  });

  it('returns null when no match', () => {
    expect(
      resolveAction('z', makeKey(), 'sidebar', bindings, actions)
    ).toBeNull();
  });

  it('scopes resolution to the given context', () => {
    expect(resolveAction('j', makeKey(), 'settings', bindings, actions)).toBe(
      'other.down'
    );
  });
});

// ── descriptorFromKeypress round-trip ─────────────────────────────

describe('descriptorFromKeypress', () => {
  it('captures a plain character', () => {
    const desc = descriptorFromKeypress('j', makeKey());
    expect(desc).toEqual({ input: 'j' });
    expect(matchesKey(desc!, 'j', makeKey())).toBe(true);
  });

  it('captures a flag key (downArrow)', () => {
    const desc = descriptorFromKeypress('', makeKey({ downArrow: true }));
    expect(desc).toEqual({ flags: { downArrow: true } });
    expect(matchesKey(desc!, '', makeKey({ downArrow: true }))).toBe(true);
  });

  it('captures Shift+Down', () => {
    const desc = descriptorFromKeypress(
      '',
      makeKey({ downArrow: true, shift: true })
    );
    expect(desc).toEqual({ shift: true, flags: { downArrow: true } });
    expect(
      matchesKey(desc!, '', makeKey({ downArrow: true, shift: true }))
    ).toBe(true);
  });

  it('does NOT set shift for uppercase letters', () => {
    const desc = descriptorFromKeypress('K', makeKey({ shift: true }));
    expect(desc).toEqual({ input: 'K' });
    // Should still match K with shift (Ink auto-shift)
    expect(matchesKey(desc!, 'K', makeKey({ shift: true }))).toBe(true);
  });

  it('returns null for empty input', () => {
    expect(descriptorFromKeypress('', makeKey())).toBeNull();
  });
});

// ── findConflict ─────────────────────────────────────────────────

describe('findConflict', () => {
  const actions: ActionDef[] = [
    { id: 'a.one', label: 'One', context: 'sidebar' },
    { id: 'a.two', label: 'Two', context: 'sidebar' },
    { id: 'a.three', label: 'Three', context: 'sidebar' },
  ];

  const bindings: Record<string, KeyDescriptor[]> = {
    'a.one': [{ input: 'j' }],
    'a.two': [{ input: 'k' }],
    'a.three': [{ input: 'q' }],
  };

  it('finds a conflicting action', () => {
    // Pressing 'k' would conflict with a.two
    expect(
      findConflict('k', makeKey(), 'sidebar', bindings, actions, 'a.one')
    ).toBe('a.two');
  });

  it('excludes the specified action from conflicts', () => {
    // Pressing 'j' — a.one uses 'j' but it's excluded
    expect(
      findConflict('j', makeKey(), 'sidebar', bindings, actions, 'a.one')
    ).toBeNull();
  });

  it('returns null when no conflict', () => {
    expect(
      findConflict('z', makeKey(), 'sidebar', bindings, actions, 'a.one')
    ).toBeNull();
  });
});
