/**
 * Shell-agnostic description of a single keypress.
 *
 * Structurally compatible with Ink's `Key` type: every field of
 * `KeyPress` maps 1:1 onto `Key` (the kitty-protocol fields are
 * optional here, so Ink-produced key objects are assignable without
 * conversion), but the type is owned by app-core so keybinding
 * resolution, input handlers, and presets have no dependency on any
 * particular UI shell. The desktop GUI synthesizes the same shape
 * from DOM keyboard events.
 */
export interface KeyPress {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
  /** Super key (Cmd on Mac, Win on Windows). Kitty keyboard protocol only. */
  super?: boolean;
  /** Hyper key. Kitty keyboard protocol only. */
  hyper?: boolean;
  /** Caps Lock is active. Kitty keyboard protocol only. */
  capsLock?: boolean;
  /** Num Lock is active. Kitty keyboard protocol only. */
  numLock?: boolean;
  /** Event type for key events. Kitty keyboard protocol only. */
  eventType?: 'press' | 'repeat' | 'release';
}
