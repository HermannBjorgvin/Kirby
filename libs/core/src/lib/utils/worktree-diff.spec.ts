import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '@kirby/diff';
import {
  parseNumstat,
  placeholderPatch,
  trimToFileBoundary,
  untrackedFilePatch,
} from './worktree-diff.js';

/**
 * New files an agent has written but not yet added.
 *
 * `git diff` cannot see an untracked file at all, so this patch is
 * written by hand — which means the parser downstream is the only thing
 * that will notice if the shape is wrong, and it will notice by
 * mis-numbering lines rather than by failing. These tests run the
 * output back through that parser instead of matching the text, since
 * agreeing with the parser is the actual requirement.
 */

function parse(patch: string) {
  return parseUnifiedDiff(patch);
}

describe('untrackedFilePatch', () => {
  it('reads back through the diff parser as an added file', () => {
    const files = parse(untrackedFilePatch('src/new.ts', 'a\nb\n'));
    expect([...files.keys()]).toEqual(['src/new.ts']);
  });

  it('marks every line as an addition, numbered from one', () => {
    const lines = parse(untrackedFilePatch('src/new.ts', 'a\nb\nc\n')).get(
      'src/new.ts'
    )!;
    expect(lines.map((l) => [l.type, l.newLine, l.content])).toEqual([
      ['hunk-header', undefined, '@@ -0,0 +1,3 @@'],
      ['add', 1, 'a'],
      ['add', 2, 'b'],
      ['add', 3, 'c'],
    ]);
  });

  it('does not invent a trailing line for the final newline', () => {
    // The same off-by-one the parser itself had: a file ending in \n
    // must not gain an empty last line, or a comment could be anchored
    // past the end of the file.
    const lines = parse(untrackedFilePatch('a.ts', 'one\n')).get('a.ts')!;
    expect(lines.filter((l) => l.type === 'add')).toHaveLength(1);
  });

  it('handles a file with no trailing newline', () => {
    const lines = parse(untrackedFilePatch('a.ts', 'one\ntwo')).get('a.ts')!;
    expect(lines.filter((l) => l.type === 'add').map((l) => l.content)).toEqual(
      ['one', 'two']
    );
  });

  it('keeps blank lines inside the file', () => {
    const lines = parse(untrackedFilePatch('a.ts', 'one\n\nthree\n')).get(
      'a.ts'
    )!;
    expect(lines.filter((l) => l.type === 'add').map((l) => l.content)).toEqual(
      ['one', '', 'three']
    );
  });

  it('emits a header but no hunk for an empty file', () => {
    // `@@ -0,0 +1,0 @@` is not a thing git writes, and a zero-length
    // hunk would leave the viewer with a file entry it cannot render.
    const patch = untrackedFilePatch('empty.txt', '');
    expect(patch).toContain('new file mode');
    expect(patch).not.toContain('@@');
  });

  it('does not mistake a line starting with + or - for a marker', () => {
    const lines = parse(untrackedFilePatch('a.md', '-dash\n+plus\n')).get(
      'a.md'
    )!;
    expect(lines.filter((l) => l.type === 'add').map((l) => l.content)).toEqual(
      ['-dash', '+plus']
    );
  });

  it('names the file on both sides so a rename check cannot fire', () => {
    expect(untrackedFilePatch('x/y.ts', 'a\n')).toContain(
      'diff --git a/x/y.ts b/x/y.ts'
    );
  });

  it('concatenates cleanly with another patch', () => {
    // Untracked patches are appended to git's own output, so two of
    // them in a row must still parse as two separate files.
    const both =
      untrackedFilePatch('one.ts', 'a\n') + untrackedFilePatch('two.ts', 'b\n');
    expect([...parse(both).keys()]).toEqual(['one.ts', 'two.ts']);
  });
});

describe('parseNumstat', () => {
  const rec = (...fields: string[]) => fields.map((f) => `${f}\0`).join('');

  it('reads a text file and its path', () => {
    expect(parseNumstat(rec('3\t1\tsrc/app.ts'))).toEqual([
      { path: 'src/app.ts', binary: false },
    ]);
  });

  it('marks a file binary when git declines to count its lines', () => {
    expect(parseNumstat(rec('-\t-\tlogo.png'))).toEqual([
      { path: 'logo.png', binary: true },
    ]);
  });

  it('takes the destination of a rename, not the empty path record', () => {
    // With -z a rename writes an empty path, then the old and new paths
    // as two further records. Reading it naively yields a file named ''
    // and swallows the two paths as if they were records of their own.
    expect(parseNumstat(rec('1\t1\t', 'old.ts', 'new.ts', '2\t0\tafter.ts'))).toEqual(
      [
        { path: 'new.ts', binary: false },
        { path: 'after.ts', binary: false },
      ]
    );
  });

  it('is empty for an empty diff', () => {
    expect(parseNumstat('')).toEqual([]);
  });
});

describe('trimToFileBoundary', () => {
  it('drops a partial last file so the parser never sees half a hunk', () => {
    const whole = untrackedFilePatch('a.ts', 'one\ntwo\n');
    const cut = `${whole}diff --git a/b.ts b/b.ts\nnew file mo`;
    expect(trimToFileBoundary(cut)).toBe(whole);
  });

  it('returns nothing when not even the first file completed', () => {
    expect(trimToFileBoundary('diff --git a/a.ts b/a.ts\nnew fi')).toBe('');
  });
});

describe('placeholderPatch', () => {
  it('reads back as a one-line file carrying its explanation', () => {
    const lines = parse(placeholderPatch('big.bin', 'file too large')).get(
      'big.bin'
    )!;
    expect(lines.filter((l) => l.type === 'add').map((l) => l.content)).toEqual([
      'file too large',
    ]);
  });
});
