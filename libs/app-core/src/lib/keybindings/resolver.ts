import type { KeyPress } from '../input/key-press.js';
import type { KeyDescriptor, InputContext, ActionDef } from './registry.js';

/**
 * A descriptor that names neither a character nor a special key can
 * never fire. `{}` is the obvious case; `{ flags: { escape: false } }`
 * is the one that bites, because it is truthy and would otherwise fall
 * through and match every keypress that happens to have no modifiers.
 */
function isBindable(descriptor: KeyDescriptor): boolean {
  if (descriptor.input !== undefined) return true;
  if (!descriptor.flags) return false;
  return Object.values(descriptor.flags).some((required) => required === true);
}

/** Every special key the descriptor asks for is down. */
function flagsHeld(descriptor: KeyDescriptor, key: KeyPress): boolean {
  if (!descriptor.flags) return true;
  return Object.entries(descriptor.flags).every(
    ([flag, required]) => !required || key[flag as keyof KeyPress]
  );
}

/**
 * A modifier has to agree in both directions: one the descriptor asks
 * for must be held, and one it stays silent about must not be — else
 * plain "Down" swallows "Shift+Down" and the more specific binding is
 * unreachable.
 */
function modifierAgrees(required: boolean | undefined, held: boolean): boolean {
  return (required === true) === Boolean(held);
}

/**
 * Ink reports a capital letter as shift+letter, so `{ input: 'K' }`
 * already means shift and must not be rejected for a modifier it never
 * spelled out. Single characters only — 'K' is shifted, 'Kb' is not a
 * key.
 */
function shiftIsImplicit(descriptor: KeyDescriptor): boolean {
  const char = descriptor.input;
  return char !== undefined && char.length === 1 && /[A-Z]/.test(char);
}

function modifiersAgree(descriptor: KeyDescriptor, key: KeyPress): boolean {
  if (!modifierAgrees(descriptor.ctrl, key.ctrl)) return false;
  if (
    !shiftIsImplicit(descriptor) &&
    !modifierAgrees(descriptor.shift, key.shift)
  )
    return false;
  // Ink sets key.meta for Escape itself, since \x1b is also the Alt
  // prefix. Escape bindings would never match if that counted.
  if (key.escape === true) return true;
  return modifierAgrees(descriptor.meta, key.meta);
}

/** Check whether a keypress matches a single key descriptor */
export function matchesKey(
  descriptor: KeyDescriptor,
  input: string,
  key: KeyPress
): boolean {
  return (
    isBindable(descriptor) &&
    (descriptor.input === undefined || descriptor.input === input) &&
    flagsHeld(descriptor, key) &&
    modifiersAgree(descriptor, key)
  );
}

/**
 * The first of `candidates` that this keypress fires, in catalog
 * order — which is how a tie between two actions sharing a key is
 * broken. Actions the preset leaves unbound are skipped.
 */
function firstActionMatching(
  candidates: readonly ActionDef[],
  input: string,
  key: KeyPress,
  bindings: Record<string, KeyDescriptor[]>
): string | null {
  for (const action of candidates) {
    const descriptors = bindings[action.id];
    if (!descriptors) continue;
    if (descriptors.some((desc) => matchesKey(desc, input, key)))
      return action.id;
  }
  return null;
}

/**
 * Resolve a keypress to an action ID within a given context.
 * Returns the action ID or null if no binding matches.
 */
export function resolveAction(
  input: string,
  key: KeyPress,
  context: InputContext,
  bindings: Record<string, KeyDescriptor[]>,
  actions: readonly ActionDef[]
): string | null {
  return firstActionMatching(
    actions.filter((a) => a.context === context),
    input,
    key,
    bindings
  );
}

/**
 * Find a conflicting action: an action in the same context that this
 * keypress would also match, excluding a given action ID.
 */
export function findConflict(
  input: string,
  key: KeyPress,
  context: InputContext,
  bindings: Record<string, KeyDescriptor[]>,
  actions: readonly ActionDef[],
  excludeActionId: string
): string | null {
  return firstActionMatching(
    actions.filter((a) => a.context === context && a.id !== excludeActionId),
    input,
    key,
    bindings
  );
}

/**
 * Build a KeyDescriptor from a raw keypress.
 * This is used to capture a user's keypress during rebind mode.
 */
export function descriptorFromKeypress(
  input: string,
  key: KeyPress
): KeyDescriptor | null {
  const desc: KeyDescriptor = {};

  // Special keys via flags
  const flagMap: [keyof KeyPress, string][] = [
    ['upArrow', 'upArrow'],
    ['downArrow', 'downArrow'],
    ['leftArrow', 'leftArrow'],
    ['rightArrow', 'rightArrow'],
    ['return', 'return'],
    ['escape', 'escape'],
    ['tab', 'tab'],
    ['backspace', 'backspace'],
    ['delete', 'delete'],
    ['pageDown', 'pageDown'],
    ['pageUp', 'pageUp'],
    ['home', 'home'],
    ['end', 'end'],
  ];

  for (const [keyFlag] of flagMap) {
    if (key[keyFlag]) {
      if (!desc.flags) desc.flags = {};
      (desc.flags as Record<string, boolean>)[keyFlag] = true;
    }
  }

  // Character input
  if (input && !desc.flags) {
    desc.input = input;
  }

  // Modifiers
  if (key.ctrl) {
    desc.ctrl = true;
    if (input) desc.input = input;
  }
  // Skip shift for uppercase letters — Ink auto-sets key.shift for A-Z,
  // and the resolver already handles this via the isUppercaseChar special case.
  const isUppercaseInput = input.length === 1 && /[A-Z]/.test(input);
  if (key.shift && !isUppercaseInput) {
    desc.shift = true;
  }
  if (key.meta) {
    desc.meta = true;
    if (input) desc.input = input;
  }

  // Must have something
  if (desc.input === undefined && !desc.flags) return null;

  return desc;
}
