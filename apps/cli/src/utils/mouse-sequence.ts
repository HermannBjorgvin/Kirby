// When SGR mouse tracking is enabled (useScrollWheel / useRawStdinForward),
// Ink's parse-keypress doesn't recognize mouse reports, so useInput
// receives them as printable input like "[<0;33;12M" (Ink strips the
// leading ESC of the first event; later events in a batched chunk keep
// theirs). Real typing never produces this shape in a single keypress —
// chars arrive one per chunk — so a full-chunk match is safe to drop.
// eslint-disable-next-line no-control-regex
const MOUSE_ONLY_RE = /^(?:\x1b?\[<\d+;\d+;\d+[Mm])+$/;

/** True when an Ink useInput `input` string is SGR mouse-report noise. */
export function isMouseSequence(input: string): boolean {
  return MOUSE_ONLY_RE.test(input);
}
