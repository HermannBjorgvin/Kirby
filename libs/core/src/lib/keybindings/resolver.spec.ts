import { describe, it, expect } from 'vitest';
import type { KeyPress } from '../input/key-press.js';
import {
  matchesKey,
  resolveAction,
  findConflict,
  descriptorFromKeypress,
} from './resolver.js';
import type { KeyDescriptor, ActionDef } from './registry.js';

// ── Helper to build a minimal KeyPress object ──────────────────────────

function makeKey(overrides: Partial<KeyPress> = {}): KeyPress {
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

  it('a descriptor whose only flag is false never matches', () => {
    // `{ flags: { downArrow: false } }` asks for nothing, so it must not
    // fall through and swallow the Down key — or every keypress.
    const desc: KeyDescriptor = { flags: { downArrow: false } };
    expect(matchesKey(desc, '', makeKey({ downArrow: true }))).toBe(false);
    expect(matchesKey(desc, '', makeKey())).toBe(false);
  });

  it('every flag a descriptor names must be set', () => {
    const desc: KeyDescriptor = { flags: { escape: true, tab: true } };
    expect(matchesKey(desc, '', makeKey({ escape: true, tab: true }))).toBe(
      true
    );
    expect(matchesKey(desc, '', makeKey({ escape: true }))).toBe(false);
    expect(matchesKey(desc, '', makeKey({ tab: true }))).toBe(false);
  });

  // ── Modifiers discriminate in both directions ───────────────────
  //
  // A descriptor that asks for a modifier must not fire without it,
  // and one that doesn't ask must not fire with it. Only the latter
  // half was covered, which is the half that lets Ctrl+Down fall
  // through to plain Down.

  it('Ctrl+f descriptor does NOT match plain f', () => {
    const desc: KeyDescriptor = { input: 'f', ctrl: true };
    expect(matchesKey(desc, 'f', makeKey())).toBe(false);
  });

  it('Shift+Down descriptor does NOT match plain Down', () => {
    const desc: KeyDescriptor = { shift: true, flags: { downArrow: true } };
    expect(matchesKey(desc, '', makeKey({ downArrow: true }))).toBe(false);
  });

  it('plain downArrow does NOT match Ctrl+Down', () => {
    // Normie binds scroll to Down and next-section to Ctrl+Down.
    const desc: KeyDescriptor = { flags: { downArrow: true } };
    expect(matchesKey(desc, '', makeKey({ downArrow: true, ctrl: true }))).toBe(
      false
    );
  });

  it('plain j does NOT match Meta+j', () => {
    const desc: KeyDescriptor = { input: 'j' };
    expect(matchesKey(desc, 'j', makeKey({ meta: true }))).toBe(false);
  });

  it('Meta+x descriptor matches only with meta held', () => {
    const desc: KeyDescriptor = { input: 'x', meta: true };
    expect(matchesKey(desc, 'x', makeKey({ meta: true }))).toBe(true);
    expect(matchesKey(desc, 'x', makeKey())).toBe(false);
  });

  it('lowercase descriptor does NOT match Shift+key', () => {
    // The uppercase exemption is for 'K', not for 'k'.
    const desc: KeyDescriptor = { input: 'k' };
    expect(matchesKey(desc, 'k', makeKey({ shift: true }))).toBe(false);
  });

  it('uppercase exemption covers shift only, not ctrl', () => {
    const desc: KeyDescriptor = { input: 'K' };
    expect(matchesKey(desc, 'K', makeKey({ shift: true, ctrl: true }))).toBe(
      false
    );
  });

  it('the meta exemption is for Escape only — Tab still rejects meta', () => {
    // Ink sets key.meta for Escape because \x1b is the Alt prefix. No
    // other key gets that pass.
    const desc: KeyDescriptor = { flags: { tab: true } };
    expect(matchesKey(desc, '', makeKey({ tab: true, meta: true }))).toBe(
      false
    );
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

  it('an action bound in another context does not fire', () => {
    // 'q' is a sidebar binding only. Pressing it in settings must do
    // nothing rather than quitting the app.
    expect(
      resolveAction('q', makeKey(), 'settings', bindings, actions)
    ).toBeNull();
  });

  it('matches on a later descriptor of the same action', () => {
    // test.down is bound to both 'j' and Down; the second one has to
    // be reached.
    expect(
      resolveAction(
        '',
        makeKey({ downArrow: true }),
        'sidebar',
        bindings,
        actions
      )
    ).toBe('test.down');
  });

  it('skips actions the preset leaves unbound', () => {
    const withUnbound: ActionDef[] = [
      { id: 'test.unbound', label: 'Unbound', context: 'sidebar' },
      ...actions,
    ];
    expect(
      resolveAction('j', makeKey(), 'sidebar', bindings, withUnbound)
    ).toBe('test.down');
  });

  it('breaks a tie by action-catalog order', () => {
    // Two actions in one context can share a key once a user rebinds.
    // The earlier entry in ACTIONS wins, deterministically.
    const clashing: ActionDef[] = [
      { id: 'first', label: 'First', context: 'sidebar' },
      { id: 'second', label: 'Second', context: 'sidebar' },
    ];
    const shared: Record<string, KeyDescriptor[]> = {
      first: [{ input: 'j' }],
      second: [{ input: 'j' }],
    };
    expect(resolveAction('j', makeKey(), 'sidebar', shared, clashing)).toBe(
      'first'
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

  it('returns null for a bare modifier press', () => {
    expect(descriptorFromKeypress('', makeKey({ ctrl: true }))).toBeNull();
  });

  it('captures Ctrl+f', () => {
    const desc = descriptorFromKeypress('f', makeKey({ ctrl: true }));
    expect(desc).toEqual({ input: 'f', ctrl: true });
    expect(matchesKey(desc!, 'f', makeKey({ ctrl: true }))).toBe(true);
    expect(matchesKey(desc!, 'f', makeKey())).toBe(false);
  });

  it('captures Meta+x', () => {
    const desc = descriptorFromKeypress('x', makeKey({ meta: true }));
    expect(desc).toEqual({ input: 'x', meta: true });
    expect(matchesKey(desc!, 'x', makeKey({ meta: true }))).toBe(true);
  });

  it('captures Ctrl+Down as a flag descriptor, not a character', () => {
    const desc = descriptorFromKeypress(
      '',
      makeKey({ downArrow: true, ctrl: true })
    );
    expect(desc).toEqual({ flags: { downArrow: true }, ctrl: true });
    expect(
      matchesKey(desc!, '', makeKey({ downArrow: true, ctrl: true }))
    ).toBe(true);
    expect(matchesKey(desc!, '', makeKey({ downArrow: true }))).toBe(false);
  });

  it('captures Escape with the meta Ink attaches to it', () => {
    const desc = descriptorFromKeypress(
      '',
      makeKey({ escape: true, meta: true })
    );
    expect(desc).toEqual({ flags: { escape: true }, meta: true });
    expect(matchesKey(desc!, '', makeKey({ escape: true, meta: true }))).toBe(
      true
    );
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

  it('does not report a clash from another context', () => {
    // The same key in two contexts is the normal case, not a conflict.
    const crossContext: ActionDef[] = [
      ...actions,
      { id: 'b.one', label: 'Elsewhere', context: 'settings' },
    ];
    const crossBindings: Record<string, KeyDescriptor[]> = {
      ...bindings,
      'b.one': [{ input: 'k' }],
    };
    expect(
      findConflict(
        'k',
        makeKey(),
        'settings',
        crossBindings,
        crossContext,
        'b.one'
      )
    ).toBeNull();
  });

  it('skips actions the preset leaves unbound', () => {
    const withUnbound: ActionDef[] = [
      { id: 'a.unbound', label: 'Unbound', context: 'sidebar' },
      ...actions,
    ];
    expect(
      findConflict('k', makeKey(), 'sidebar', bindings, withUnbound, 'a.one')
    ).toBe('a.two');
  });
});
