import { describe, it, expect } from 'vitest';
import type { Key } from 'ink';
import {
  ACTIONS,
  NORMIE_PRESET,
  VIM_PRESET,
  type ActionId,
  type KeybindPreset,
} from './registry.js';
import { resolveAction, findConflict } from './resolver.js';

// Helper — same shape as resolver.spec.ts's, kept local so the two
// files stay independent.
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

function actionExists(id: string): boolean {
  return ACTIONS.some((a) => a.id === id);
}

function resolveInPreset(
  input: string,
  key: Key,
  context: 'diff-file-list' | 'diff-viewer',
  preset: KeybindPreset
): string | null {
  return resolveAction(input, key, context, preset.bindings, ACTIONS);
}

// ── New diff-file-list parity actions ─────────────────────────────
//
// Milestone 1 of the UX-parity plan. These must exist and resolve in
// both presets so the file list feels like the same system as the
// diff viewer.

describe('registry — diff-file-list comment actions', () => {
  const requiredActions: ActionId[] = [
    'diff-file-list.next-comment',
    'diff-file-list.prev-comment',
    'diff-file-list.next-section',
    'diff-file-list.prev-section',
    'diff-file-list.reply-to-thread',
    'diff-file-list.toggle-thread-resolved',
  ];

  it.each(requiredActions)('registers %s in ACTIONS', (id) => {
    expect(actionExists(id)).toBe(true);
  });

  it.each(requiredActions)('has a Normie binding for %s', (id) => {
    expect(NORMIE_PRESET.bindings[id]).toBeDefined();
    expect(NORMIE_PRESET.bindings[id]!.length).toBeGreaterThan(0);
  });

  it.each(requiredActions)('has a Vim binding for %s', (id) => {
    expect(VIM_PRESET.bindings[id]).toBeDefined();
    expect(VIM_PRESET.bindings[id]!.length).toBeGreaterThan(0);
  });

  // ── Specific key ↔ action mappings ────────────────────────────
  //
  // The plan commits to specific bindings the user asked for. These
  // tests lock them in so a preset refactor can't silently regress.

  describe('Normie preset mappings', () => {
    it('Shift+Down → next-comment', () => {
      expect(
        resolveInPreset(
          '',
          makeKey({ downArrow: true, shift: true }),
          'diff-file-list',
          NORMIE_PRESET
        )
      ).toBe('diff-file-list.next-comment');
    });

    it('Shift+Up → prev-comment', () => {
      expect(
        resolveInPreset(
          '',
          makeKey({ upArrow: true, shift: true }),
          'diff-file-list',
          NORMIE_PRESET
        )
      ).toBe('diff-file-list.prev-comment');
    });

    it('Ctrl+Down → next-section', () => {
      expect(
        resolveInPreset(
          '',
          makeKey({ downArrow: true, ctrl: true }),
          'diff-file-list',
          NORMIE_PRESET
        )
      ).toBe('diff-file-list.next-section');
    });

    it('Ctrl+Up → prev-section', () => {
      expect(
        resolveInPreset(
          '',
          makeKey({ upArrow: true, ctrl: true }),
          'diff-file-list',
          NORMIE_PRESET
        )
      ).toBe('diff-file-list.prev-section');
    });

    it('r → reply-to-thread', () => {
      expect(
        resolveInPreset('r', makeKey(), 'diff-file-list', NORMIE_PRESET)
      ).toBe('diff-file-list.reply-to-thread');
    });

    it('v → toggle-thread-resolved', () => {
      expect(
        resolveInPreset('v', makeKey(), 'diff-file-list', NORMIE_PRESET)
      ).toBe('diff-file-list.toggle-thread-resolved');
    });
  });

  describe('Vim preset mappings', () => {
    it('c → next-comment', () => {
      expect(
        resolveInPreset('c', makeKey(), 'diff-file-list', VIM_PRESET)
      ).toBe('diff-file-list.next-comment');
    });

    it('C → prev-comment (uppercase — shift flag is Ink-auto-set)', () => {
      expect(
        resolveInPreset(
          'C',
          makeKey({ shift: true }),
          'diff-file-list',
          VIM_PRESET
        )
      ).toBe('diff-file-list.prev-comment');
    });

    it('Ctrl+Down → next-section', () => {
      expect(
        resolveInPreset(
          '',
          makeKey({ downArrow: true, ctrl: true }),
          'diff-file-list',
          VIM_PRESET
        )
      ).toBe('diff-file-list.next-section');
    });

    it('r → reply-to-thread', () => {
      expect(
        resolveInPreset('r', makeKey(), 'diff-file-list', VIM_PRESET)
      ).toBe('diff-file-list.reply-to-thread');
    });

    it('v → toggle-thread-resolved', () => {
      expect(
        resolveInPreset('v', makeKey(), 'diff-file-list', VIM_PRESET)
      ).toBe('diff-file-list.toggle-thread-resolved');
    });
  });

  // ── Conflict guard ────────────────────────────────────────────
  //
  // Within the same context, a keypress must not resolve to more than
  // one action. findConflict returning null for each new binding
  // proves the bindings we're adding don't stomp on existing ones.

  describe('no conflicts within diff-file-list context', () => {
    const checks: {
      name: string;
      input: string;
      key: Key;
      id: ActionId;
    }[] = [
      {
        name: 'Shift+Down',
        input: '',
        key: makeKey({ downArrow: true, shift: true }),
        id: 'diff-file-list.next-comment',
      },
      {
        name: 'Shift+Up',
        input: '',
        key: makeKey({ upArrow: true, shift: true }),
        id: 'diff-file-list.prev-comment',
      },
      {
        name: 'Ctrl+Down',
        input: '',
        key: makeKey({ downArrow: true, ctrl: true }),
        id: 'diff-file-list.next-section',
      },
      {
        name: 'Ctrl+Up',
        input: '',
        key: makeKey({ upArrow: true, ctrl: true }),
        id: 'diff-file-list.prev-section',
      },
      {
        name: 'r',
        input: 'r',
        key: makeKey(),
        id: 'diff-file-list.reply-to-thread',
      },
      {
        name: 'v',
        input: 'v',
        key: makeKey(),
        id: 'diff-file-list.toggle-thread-resolved',
      },
    ];

    it.each(checks)(
      'Normie $name does not conflict with another action',
      ({ input, key, id }) => {
        expect(
          findConflict(
            input,
            key,
            'diff-file-list',
            NORMIE_PRESET.bindings,
            ACTIONS,
            id
          )
        ).toBeNull();
      }
    );

    it.each(checks)(
      'Vim $name does not conflict with another action',
      ({ input, key, id }) => {
        expect(
          findConflict(
            input,
            key,
            'diff-file-list',
            VIM_PRESET.bindings,
            ACTIONS,
            id
          )
        ).toBeNull();
      }
    );
  });
});
