/**
 * Keyboard movement over a vertical list of choices with a roving
 * focus: which choice a key lands on, given the one focused now.
 *
 * `index` is -1 when focus is not on a choice at all — the dialog's
 * footer, say — and the arrows then enter the list from the end they
 * point away from, the way a list with no current row behaves.
 * Returns `null` for a key that is not movement, or an empty list.
 */
export function stepChoice(
  key: string,
  index: number,
  count: number
): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowUp':
      return index < 0 ? count - 1 : (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
