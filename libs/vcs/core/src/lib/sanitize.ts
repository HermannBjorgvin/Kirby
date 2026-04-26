// Strip ANSI escape sequences from text that originates from an
// untrusted remote source (PR/issue/thread bodies). A reviewer's
// comment containing `\x1b[2J\x1b[H` would otherwise clear Kirby's
// terminal when the body is rendered to <Text>; `\x1b[8m` hides
// content; cursor-position writes can fake a Kirby UI line.
//
// Pattern source: ansi-regex (chalk org). Covers CSI (`\x1b[…m`),
// OSC (`\x1b]…BEL`), and SS3/SCS variants. Simpler than ansi-regex
// because we don't need its terminator nuances — every sequence
// becomes the empty string regardless.
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /[][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

/**
 * Remove ANSI escape sequences from `text`. Idempotent. Returns the
 * input unchanged when there's nothing to strip.
 */
export function sanitizeBody(text: string): string {
  return text.replace(ANSI_REGEX, '');
}
