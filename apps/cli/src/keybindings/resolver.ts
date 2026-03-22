import type { Key } from 'ink';
import type { KeyDescriptor, InputContext, ActionDef } from './registry.js';

/** Check whether a keypress matches a single key descriptor */
export function matchesKey(
  descriptor: KeyDescriptor,
  input: string,
  key: Key
): boolean {
  // Must have at least input or flags to match
  if (descriptor.input === undefined && !descriptor.flags) return false;

  // Check character match
  if (descriptor.input !== undefined && descriptor.input !== input)
    return false;

  // Check special key flags — all specified flags must be true
  if (descriptor.flags) {
    for (const [flag, required] of Object.entries(descriptor.flags)) {
      if (required && !key[flag as keyof Key]) return false;
    }
  }

  // If only flags specified (no input), make sure we're not matching on a
  // regular character press that just happens to have no flags set
  if (descriptor.input === undefined && descriptor.flags) {
    const hasAnyFlag = Object.entries(descriptor.flags).some(
      ([, v]) => v === true
    );
    if (!hasAnyFlag) return false;
  }

  // Check modifiers — if a descriptor doesn't mention a modifier,
  // it should only match when that modifier is NOT pressed.
  // This prevents plain "Down" from swallowing "Shift+Down".
  //
  // Special case for shift: Ink auto-sets key.shift=true for uppercase
  // letters (A-Z), so a descriptor with input='K' implicitly includes
  // shift. Only enforce shift mismatch for non-character keys (flags).
  if (descriptor.ctrl === true && !key.ctrl) return false;
  if (descriptor.ctrl !== true && key.ctrl) return false;

  const isUppercaseChar =
    descriptor.input !== undefined &&
    descriptor.input.length === 1 &&
    /[A-Z]/.test(descriptor.input);
  if (!isUppercaseChar) {
    if (descriptor.shift === true && !key.shift) return false;
    if (descriptor.shift !== true && key.shift) return false;
  }

  // Special case for meta: Ink sets key.meta=true for Escape itself
  // (since \x1b is also the Alt prefix). Don't reject escape-flagged
  // descriptors for having meta set.
  const isEscapeKey = key.escape === true;
  if (!isEscapeKey) {
    if (descriptor.meta === true && !key.meta) return false;
    if (descriptor.meta !== true && key.meta) return false;
  }

  return true;
}

/**
 * Resolve a keypress to an action ID within a given context.
 * Returns the action ID or null if no binding matches.
 */
export function resolveAction(
  input: string,
  key: Key,
  context: InputContext,
  bindings: Record<string, KeyDescriptor[]>,
  actions: ActionDef[]
): string | null {
  const contextActions = actions.filter((a) => a.context === context);

  for (const action of contextActions) {
    const descriptors = bindings[action.id];
    if (!descriptors) continue;
    for (const desc of descriptors) {
      if (matchesKey(desc, input, key)) return action.id;
    }
  }
  return null;
}

/**
 * Find a conflicting action: an action in the same context that this
 * keypress would also match, excluding a given action ID.
 */
export function findConflict(
  input: string,
  key: Key,
  context: InputContext,
  bindings: Record<string, KeyDescriptor[]>,
  actions: ActionDef[],
  excludeActionId: string
): string | null {
  const contextActions = actions.filter(
    (a) => a.context === context && a.id !== excludeActionId
  );
  for (const action of contextActions) {
    const descriptors = bindings[action.id];
    if (!descriptors) continue;
    for (const desc of descriptors) {
      if (matchesKey(desc, input, key)) return action.id;
    }
  }
  return null;
}

/**
 * Build a KeyDescriptor from a raw keypress.
 * This is used to capture a user's keypress during rebind mode.
 */
export function descriptorFromKeypress(
  input: string,
  key: Key
): KeyDescriptor | null {
  const desc: KeyDescriptor = {};

  // Special keys via flags
  const flagMap: [keyof Key, string][] = [
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
  if (key.shift) {
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
