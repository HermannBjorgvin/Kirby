import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { KeyPress } from '../input/key-press.js';
import {
  ACTIONS,
  PRESETS,
  type ActionDef,
  type KeyDescriptor,
} from './registry.js';
import {
  descriptorFromKeypress,
  matchesKey,
  resolveAction,
} from './resolver.js';

/**
 * Property tests for keybinding resolution, alongside the worked cases
 * in resolver.spec.ts.
 *
 * The failures worth catching here are not "this key does the wrong
 * thing" — that gets noticed in a second — but a whole *shape* of
 * binding going dead in one preset, or a modifier quietly ceasing to
 * discriminate so Ctrl+Down starts doing what Down does. Both are
 * statements about every binding in every preset rather than facts
 * about any one key, so they are stated that way.
 *
 * The binding is drawn by fast-check rather than looped over so it
 * composes with the perturbation each property applies; `numRuns` is
 * set well past the coupon-collector bound for the ~230 bindings, so
 * every one of them is exercised on every run.
 */

const RUNS = 4000;

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
    ...overrides,
  };
}

/**
 * The keypress a user makes to trigger a descriptor, as Ink reports
 * it: flags verbatim, plus the implicit shift Ink attaches to capital
 * letters (which is why no preset spells that shift out).
 */
function keypressFor(desc: KeyDescriptor): { input: string; key: KeyPress } {
  return {
    input: desc.input ?? '',
    key: makeKey({
      ...desc.flags,
      ctrl: desc.ctrl === true,
      meta: desc.meta === true,
      shift:
        desc.shift === true ||
        (desc.input !== undefined && /[A-Z]/.test(desc.input)),
    }),
  };
}

interface Binding {
  presetId: string;
  action: ActionDef;
  desc: KeyDescriptor;
}

const BINDINGS: Binding[] = PRESETS.flatMap((preset) =>
  ACTIONS.flatMap((action) =>
    (preset.bindings[action.id] ?? []).map((desc) => ({
      presetId: preset.id,
      action: action as ActionDef,
      desc,
    }))
  )
);

function bindingsOf(presetId: string): Record<string, KeyDescriptor[]> {
  return PRESETS.find((p) => p.id === presetId)!.bindings;
}

function anyBinding(): fc.Arbitrary<Binding> {
  return fc.constantFrom(...BINDINGS);
}

/** Resolve a keypress in the binding's own preset and context. */
function resolveFor(
  binding: Binding,
  input: string,
  key: KeyPress
): string | null {
  return resolveAction(
    input,
    key,
    binding.action.context,
    bindingsOf(binding.presetId),
    ACTIONS
  );
}

describe('preset bindings', () => {
  it('covers both presets', () => {
    expect(BINDINGS.length).toBeGreaterThan(200);
    expect(new Set(BINDINGS.map((b) => b.presetId))).toEqual(
      new Set(['normie', 'vim'])
    );
  });

  it('each one resolves back to the action it is bound to', () => {
    fc.assert(
      fc.property(anyBinding(), (binding) => {
        const { input, key } = keypressFor(binding.desc);
        expect(resolveFor(binding, input, key)).toBe(binding.action.id);
      }),
      { numRuns: RUNS }
    );
  });
});

// ── Modifiers discriminate ────────────────────────────────────────
//
// A modifier the descriptor never asked for has to stop it matching,
// or the more specific binding is unreachable. The two exclusions
// below are the places Ink lies about modifiers, and are the whole
// reason matchesKey is not a plain equality check.

describe('a modifier the binding did not ask for', () => {
  it('kills the match when it is Ctrl', () => {
    fc.assert(
      fc.property(
        anyBinding().filter((b) => b.desc.ctrl !== true),
        (binding) => {
          const { input, key } = keypressFor(binding.desc);
          expect(resolveFor(binding, input, { ...key, ctrl: true })).not.toBe(
            binding.action.id
          );
        }
      ),
      { numRuns: RUNS }
    );
  });

  it('kills the match when it is Shift — except on a capital letter', () => {
    fc.assert(
      fc.property(
        anyBinding().filter(
          (b) =>
            b.desc.shift !== true &&
            // Ink reports 'K' as shift+k, so `{ input: 'K' }` already
            // means shift and cannot be perturbed by adding it.
            !(b.desc.input !== undefined && /[A-Z]/.test(b.desc.input))
        ),
        (binding) => {
          const { input, key } = keypressFor(binding.desc);
          expect(resolveFor(binding, input, { ...key, shift: true })).not.toBe(
            binding.action.id
          );
        }
      ),
      { numRuns: RUNS }
    );
  });

  it('kills the match when it is Meta — except on Escape', () => {
    fc.assert(
      fc.property(
        anyBinding().filter(
          (b) =>
            b.desc.meta !== true &&
            // Ink sets meta for Escape itself (\x1b is also the Alt
            // prefix), so escape bindings are exempt from meta.
            b.desc.flags?.escape !== true
        ),
        (binding) => {
          const { input, key } = keypressFor(binding.desc);
          expect(resolveFor(binding, input, { ...key, meta: true })).not.toBe(
            binding.action.id
          );
        }
      ),
      { numRuns: RUNS }
    );
  });
});

// ── Rebind capture ────────────────────────────────────────────────
//
// descriptorFromKeypress closes the loop: whatever the user presses
// while rebinding is stored as a descriptor, and pressing the same
// thing afterwards has to fire it. Over arbitrary keypresses rather
// than the presets, because a rebind can capture combinations no
// preset ships.

const FLAG_KEYS = [
  'upArrow',
  'downArrow',
  'leftArrow',
  'rightArrow',
  'return',
  'escape',
  'tab',
  'backspace',
  'delete',
  'pageDown',
  'pageUp',
  'home',
  'end',
] as const;

const arbitraryModifiers = () =>
  fc.record({ ctrl: fc.boolean(), shift: fc.boolean(), meta: fc.boolean() });

/**
 * A keypress the way Ink actually reports one: either a character with
 * no special-key flag, or a special key with no character. Generating
 * both at once (input 'K' *and* backspace) describes a press no
 * terminal produces, and the resolver is not written for it.
 */
function arbitraryKeypress(): fc.Arbitrary<{ input: string; key: KeyPress }> {
  const characterPress = fc
    .record({
      input: fc.constantFrom('j', 'K', 'A', '?', ' ', '1', '.'),
      mods: arbitraryModifiers(),
    })
    .map(({ input, mods }) => ({ input, key: makeKey(mods) }));

  const specialKeyPress = fc
    .record({
      flags: fc.subarray([...FLAG_KEYS], { minLength: 1, maxLength: 2 }),
      mods: arbitraryModifiers(),
    })
    .map(({ flags, mods }) => ({
      input: '',
      key: makeKey({
        ...Object.fromEntries(flags.map((f) => [f, true])),
        ...mods,
      }),
    }));

  return fc.oneof(
    characterPress,
    specialKeyPress,
    fc.constant({
      input: '',
      key: makeKey(),
    })
  );
}

describe('a descriptor captured from a keypress', () => {
  it('matches the keypress it was captured from', () => {
    fc.assert(
      fc.property(arbitraryKeypress(), ({ input, key }) => {
        const desc = descriptorFromKeypress(input, key);
        fc.pre(desc !== null);
        expect(matchesKey(desc!, input, key)).toBe(true);
      })
    );
  });

  it('stops matching once Ctrl differs', () => {
    fc.assert(
      fc.property(arbitraryKeypress(), ({ input, key }) => {
        const desc = descriptorFromKeypress(input, key);
        fc.pre(desc !== null);
        expect(matchesKey(desc!, input, { ...key, ctrl: !key.ctrl })).toBe(
          false
        );
      })
    );
  });
});
