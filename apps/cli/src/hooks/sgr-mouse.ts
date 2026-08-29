// SGR mouse reporting — the wire format both stdin readers parse.
//
// A report is `ESC [ < btn ; col ; row` followed by `M` for a press or
// `m` for a release. The escape byte is the whole point of the pattern,
// and a control character in a regex is what `no-control-regex` exists
// to flag, so the one suppression in this file is the price of matching
// terminal input at all. Keeping the format here means the two readers
// cannot drift on what a scroll event looks like.

/** Wheel-up in SGR button encoding. */
export const SGR_SCROLL_UP = 64;
/** Wheel-down in SGR button encoding. */
export const SGR_SCROLL_DOWN = 65;

/**
 * A fresh matcher for SGR mouse reports.
 *
 * Returned rather than shared because the pattern is global: a module
 * scope `/g` regex carries `lastIndex` between calls, so two readers —
 * or two chunks — would resume mid-string and miss the first event.
 *
 * Capture groups: 1 button, 2 column, 3 row, 4 `M` press / `m` release.
 */
export function sgrMouseMatcher(): RegExp {
  // eslint-disable-next-line no-control-regex -- ESC is the sequence's first byte
  return /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
}
