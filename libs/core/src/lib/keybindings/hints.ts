import type { KeyDescriptor, ActionDef, InputContext } from './registry.js';

/** Convert a single KeyDescriptor to a human-readable string */
export function keyDescriptorToString(desc: KeyDescriptor): string {
  const modifiers: string[] = [];
  const keys: string[] = [];

  // Modifiers first (consistent order: Ctrl, Shift, Alt)
  if (desc.ctrl) modifiers.push('Ctrl');
  if (desc.shift) modifiers.push('Shift');
  if (desc.meta) modifiers.push('Alt');

  // Special key flags
  if (desc.flags) {
    if (desc.flags.upArrow) keys.push('↑');
    if (desc.flags.downArrow) keys.push('↓');
    if (desc.flags.leftArrow) keys.push('←');
    if (desc.flags.rightArrow) keys.push('→');
    if (desc.flags.return) keys.push('Enter');
    if (desc.flags.escape) keys.push('Esc');
    if (desc.flags.tab) keys.push('Tab');
    if (desc.flags.backspace) keys.push('Bksp');
    if (desc.flags.delete) keys.push('Del');
    if (desc.flags.pageDown) keys.push('PgDn');
    if (desc.flags.pageUp) keys.push('PgUp');
    if (desc.flags.home) keys.push('Home');
    if (desc.flags.end) keys.push('End');
  }

  // Character input — show uppercase as Shift+lowercase for clarity
  if (desc.input !== undefined) {
    if (desc.input === ' ') keys.push('Space');
    else if (desc.input.length === 1 && /[A-Z]/.test(desc.input)) {
      if (!modifiers.includes('Shift')) modifiers.push('Shift');
      keys.push(desc.input.toLowerCase());
    } else keys.push(desc.input);
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
