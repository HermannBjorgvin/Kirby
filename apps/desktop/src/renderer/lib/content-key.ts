/**
 * A short, stable key for a large piece of text, so the text itself
 * does not have to travel in a query key.
 *
 * TanStack hashes a query key with `JSON.stringify` on every render of
 * every observer, so a multi-megabyte string in a key is re-stringified
 * per render. Measured on this machine (node 22, 1 KB-per-line patch):
 *
 * | patch size | JSON.stringify(key), per render | contentKey, per change |
 * | ---------- | ------------------------------- | ---------------------- |
 * | 100 KB     | 0.11 ms                         | 0.25 ms                |
 * | 1 MB       | 1.74 ms                         | 1.27 ms                |
 * | 4 MB       | 7.74 ms                         | 5.45 ms                |
 *
 * Whole-file diffs (`-U99999`) reach the bottom row, where the raw key
 * costs half a frame on every keystroke and scroll. The hash costs the
 * same order of magnitude, but only when the content actually changes.
 *
 * cyrb53: 53 bits, paired with the length so two patches must collide
 * in both to share a key.
 */
export function contentKey(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${text.length}-${hash.toString(36)}`;
}
