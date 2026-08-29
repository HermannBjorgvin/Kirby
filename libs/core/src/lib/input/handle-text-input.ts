import type { KeyPress } from './key-press.js';

/**
 * Handle common text-input key patterns: backspace to delete last char,
 * printable input to append. Returns true if the key was handled.
 */
export function handleTextInput(
  input: string,
  key: KeyPress,
  setter: (fn: (prev: string) => string) => void
): boolean {
  if (key.backspace || key.delete) {
    setter((v) => v.slice(0, -1));
    return true;
  }
  if (input && !key.ctrl && !key.meta) {
    setter((v) => v + input);
    return true;
  }
  return false;
}
