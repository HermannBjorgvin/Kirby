import type { KeyDescriptor, ActionDef, InputContext } from './registry.js';

type ModifierKey = 'ctrl' | 'shift' | 'meta';
type FlagKey = keyof NonNullable<KeyDescriptor['flags']>;

/**
 * Both tables are ordered, and the order is the rendering order — a chord
 * always reads the same way regardless of which order its descriptor happens
 * to list the flags in.
 */
const MODIFIER_LABELS: readonly (readonly [ModifierKey, string])[] = [
  ['ctrl', 'Ctrl'],
  ['shift', 'Shift'],
  ['meta', 'Alt'],
];

const FLAG_LABELS: readonly (readonly [FlagKey, string])[] = [
  ['upArrow', '↑'],
  ['downArrow', '↓'],
  ['leftArrow', '←'],
  ['rightArrow', '→'],
  ['return', 'Enter'],
  ['escape', 'Esc'],
  ['tab', 'Tab'],
  ['backspace', 'Bksp'],
  ['delete', 'Del'],
  ['pageDown', 'PgDn'],
  ['pageUp', 'PgUp'],
  ['home', 'Home'],
  ['end', 'End'],
];

/**
 * How a character key reads, and whether saying so implies Shift.
 *
 * A capital letter is the one case where the character alone understates the
 * chord: 'A' is really Shift+a, so it contributes a modifier as well as a key.
 */
function describeInput(input: string): { shift: boolean; label: string } {
  if (input === ' ') return { shift: false, label: 'Space' };
  if (input.length === 1 && /[A-Z]/.test(input))
    return { shift: true, label: input.toLowerCase() };
  return { shift: false, label: input };
}

/** Convert a single KeyDescriptor to a human-readable string */
export function keyDescriptorToString(desc: KeyDescriptor): string {
  const modifiers = MODIFIER_LABELS.filter(([flag]) => desc[flag]).map(
    ([, label]) => label
  );

  const flags = desc.flags;
  const keys = flags
    ? FLAG_LABELS.filter(([flag]) => flags[flag]).map(([, label]) => label)
    : [];

  if (desc.input !== undefined) {
    const { shift, label } = describeInput(desc.input);
    if (shift && !modifiers.includes('Shift')) modifiers.push('Shift');
    keys.push(label);
  }

  if (keys.length === 0 && modifiers.length === 0) return '?';

  return [...modifiers, ...keys].join('+');
}

/** Convert all KeyDescriptors for an action to a combined display string */
export function keysToDisplayString(descriptors: KeyDescriptor[]): string {
  return descriptors.map(keyDescriptorToString).join('/');
}

export interface HintEntry {
  actionId: string;
  keys: string;
  label: string;
  vcsOnly?: boolean;
}

/**
 * Get hint entries for a given context from the current bindings.
 * Only includes actions with showInHints=true.
 */
export function getHintsForContext(
  context: InputContext,
  actions: readonly ActionDef[],
  bindings: Record<string, KeyDescriptor[]>
): HintEntry[] {
  const contextActions = actions.filter(
    (a) => a.context === context && a.showInHints && a.hintLabel
  );

  return contextActions
    .map((action) => {
      const descriptors = bindings[action.id];
      if (!descriptors || descriptors.length === 0) return null;
      const entry: HintEntry = {
        actionId: action.id,
        keys: keysToDisplayString(descriptors),
        label: action.hintLabel!,
      };
      if (action.vcsOnly) entry.vcsOnly = true;
      return entry;
    })
    .filter((h): h is HintEntry => h !== null);
}

/**
 * Get the "navigate down / navigate up" pair as a combined hint.
 * Returns e.g. "j/k" or "Down/Up" depending on preset.
 */
export function getNavHintKeys(
  contextPrefix: string,
  bindings: Record<string, KeyDescriptor[]>
): string {
  const downDescs = bindings[`${contextPrefix}.navigate-down`];
  const upDescs = bindings[`${contextPrefix}.navigate-up`];
  if (!downDescs?.length || !upDescs?.length) return '?/?';

  // Use the first (primary) key for each
  const downStr = keyDescriptorToString(downDescs[0]!);
  const upStr = keyDescriptorToString(upDescs[0]!);
  return `${downStr}/${upStr}`;
}
