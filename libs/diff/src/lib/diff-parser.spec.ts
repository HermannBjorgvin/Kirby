import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff-parser.js';

/**
 * The parser everything else stands on.
 *
 * `git diff` text comes in here and `DiffLine[]` comes out, and every
 * consumer — the TUI's viewer, the desktop's folding and split view,
 * every comment anchor — trusts the line numbers it stamps. Those are
 * the one thing a reader cannot check for themselves: a comment
 * anchored to the wrong line looks perfectly reasonable on screen.
 *
 * Nothing tested it, and the layers above build their own DiffLine
 * fixtures by hand, so a mis-numbering here would have been invisible
 * all the way up.
 */

const SIMPLE = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;

describe('parseUnifiedDiff', () => {
  it('keys files by their new path', () => {
    const files = parseUnifiedDiff(SIMPLE);
    expect([...files.keys()]).toEqual(['src/a.ts']);
  });

  it('numbers each side independently, the way git counts', () => {
    const lines = parseUnifiedDiff(SIMPLE).get('src/a.ts')!;
    expect(lines.map((l) => [l.type, l.oldLine, l.newLine, l.content])).toEqual(
      [
        ['hunk-header', undefined, undefined, '@@ -1,4 +1,5 @@'],
        ['context', 1, 1, 'const a = 1;'],
        ['remove', 2, undefined, 'const b = 2;'],
        ['add', undefined, 2, 'const b = 3;'],
        ['add', undefined, 3, 'const c = 4;'],
        // The context line after two additions sits at old 3, new 4 —
        // this is where an off-by-one in either counter shows up.
        ['context', 3, 4, 'const d = 5;'],
      ]
    );
  });

  it('restarts numbering at each hunk header', () => {
    const lines = parseUnifiedDiff(
      `diff --git a/x b/x
@@ -1,2 +1,2 @@
 one
-two
+TWO
@@ -50,2 +50,2 @@
 fifty
-fiftyone
+FIFTYONE
`
    ).get('x')!;
    const second = lines.slice(
      lines.lastIndexOf(
        lines.find((l, i) => i > 0 && l.type === 'hunk-header')!
      )
    );
    expect(second[1]).toMatchObject({
      type: 'context',
      oldLine: 50,
      newLine: 50,
    });
    expect(second[2]).toMatchObject({ type: 'remove', oldLine: 51 });
    expect(second[3]).toMatchObject({ type: 'add', newLine: 51 });
  });

  it('handles a hunk header with no line counts', () => {
    // Single-line hunks are written `@@ -1 +1 @@`, without the counts.
    const lines = parseUnifiedDiff(
      `diff --git a/x b/x
@@ -7 +9 @@
-old
+new
`
    ).get('x')!;
    expect(lines[1]).toMatchObject({ type: 'remove', oldLine: 7 });
    expect(lines[2]).toMatchObject({ type: 'add', newLine: 9 });
  });

  it('separates multiple files', () => {
    const files = parseUnifiedDiff(
      `diff --git a/one.ts b/one.ts
@@ -1 +1 @@
-a
+b
diff --git a/two.ts b/two.ts
@@ -1 +1 @@
-c
+d
`
    );
    expect([...files.keys()]).toEqual(['one.ts', 'two.ts']);
    expect(files.get('two.ts')!.map((l) => l.content)).toEqual([
      '@@ -1 +1 @@',
      'c',
      'd',
    ]);
  });

  it('keeps a renamed file under its new name', () => {
    // Comments and file lists address the file as it is now.
    const files = parseUnifiedDiff(
      `diff --git a/old/name.ts b/new/name.ts
@@ -1 +1 @@
-a
+b
`
    );
    expect([...files.keys()]).toEqual(['new/name.ts']);
  });

  it('drops the index and ---/+++ headers rather than rendering them', () => {
    const lines = parseUnifiedDiff(SIMPLE).get('src/a.ts')!;
    expect(lines.some((l) => l.content.startsWith('index '))).toBe(false);
    expect(lines.some((l) => l.content.startsWith('--- '))).toBe(false);
    expect(lines.some((l) => l.content.startsWith('+++ '))).toBe(false);
  });

  it('ignores the no-newline marker without consuming a line number', () => {
    const lines = parseUnifiedDiff(
      `diff --git a/x b/x
@@ -1,2 +1,2 @@
 keep
-old
\\ No newline at end of file
+new
`
    ).get('x')!;
    // Counting the marker as a line would shift everything after it.
    expect(lines.map((l) => l.type)).toEqual([
      'hunk-header',
      'context',
      'remove',
      'add',
    ]);
    expect(lines[3]).toMatchObject({ type: 'add', newLine: 2 });
  });

  it('treats a fully blank line as context', () => {
    // git writes an unchanged empty line as an empty string, not " ".
    const lines = parseUnifiedDiff(
      `diff --git a/x b/x
@@ -1,3 +1,3 @@
 one

 three
`
    ).get('x')!;
    expect(lines[2]).toMatchObject({ type: 'context', content: '' });
    expect(lines[3]).toMatchObject({ type: 'context', oldLine: 3, newLine: 3 });
  });

  it('strips the carriage return from CRLF files', () => {
    // A surviving \r sends the terminal's cursor back to column 0
    // mid-row and paints the next row over it.
    const lines = parseUnifiedDiff(
      'diff --git a/x b/x\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n'
    ).get('x')!;
    expect(lines.map((l) => l.content)).toEqual(['@@ -1 +1 @@', 'old', 'new']);
    expect(lines.some((l) => l.content.includes('\r'))).toBe(false);
  });

  it('keeps a removed line whose own text starts with a dash', () => {
    // Only the first character is the marker: "- dashes" is content.
    const lines = parseUnifiedDiff(
      `diff --git a/x b/x
@@ -1,1 +1,1 @@
-- dashes
`
    ).get('x')!;
    expect(lines[1]).toMatchObject({
      type: 'remove',
      content: '- dashes',
      oldLine: 1,
    });
  });

  it('adds no trailing blank line for the newline git ends output with', () => {
    // Read as unchanged context it appended a row to the last file of
    // every diff, numbered one past the end — a line that is not there,
    // which comment anchoring would happily resolve against.
    const lines = parseUnifiedDiff(SIMPLE).get('src/a.ts')!;
    expect(lines[lines.length - 1]).toMatchObject({
      type: 'context',
      content: 'const d = 5;',
    });
  });

  it('still keeps a blank line in the middle of a file', () => {
    const lines = parseUnifiedDiff(
      `diff --git a/x b/x
@@ -1,3 +1,3 @@
 one

 three
`
    ).get('x')!;
    expect(lines.map((l) => l.content)).toEqual([
      '@@ -1,3 +1,3 @@',
      'one',
      '',
      'three',
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseUnifiedDiff('').size).toBe(0);
  });

  it('ignores body lines that arrive before any file header', () => {
    // Truncated or prefixed output must not invent a file.
    expect(parseUnifiedDiff('+orphan line\n-another\n').size).toBe(0);
  });
});
