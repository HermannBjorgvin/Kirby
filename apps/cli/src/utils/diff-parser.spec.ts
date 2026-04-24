import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '@kirby/diff';

describe('parseUnifiedDiff — line-ending handling', () => {
  it('strips trailing CR from CRLF-delimited diff text', () => {
    // Source file with Windows line endings produces a diff where
    // every line has a trailing \r before the \n. The parser splits
    // on \n but leaves \r in-content, which when rendered through a
    // terminal drags the cursor back to column 0 mid-row and
    // overlays the next row's content. We defensively strip it.
    const diffText =
      'diff --git a/app.ts b/app.ts\r\n' +
      'index 1..2 100644\r\n' +
      '--- a/app.ts\r\n' +
      '+++ b/app.ts\r\n' +
      '@@ -1,2 +1,2 @@\r\n' +
      '-old line one\r\n' +
      '+new line one\r\n' +
      ' context line\r\n';

    const parsed = parseUnifiedDiff(diffText);
    const lines = parsed.get('app.ts');
    expect(lines).toBeDefined();

    const byType = lines!.filter((l) => l.type !== 'hunk-header');
    for (const line of byType) {
      expect(line.content.endsWith('\r')).toBe(false);
      expect(line.content).not.toContain('\r');
    }
    expect(byType[0].content).toBe('old line one');
    expect(byType[1].content).toBe('new line one');
    expect(byType[2].content).toBe('context line');
  });

  it('LF-only diff text parses unchanged', () => {
    const diffText =
      'diff --git a/a.ts b/a.ts\n' +
      '@@ -1,1 +1,1 @@\n' +
      '-hello\n' +
      '+world\n';
    const parsed = parseUnifiedDiff(diffText);
    const lines = parsed.get('a.ts')!;
    const byType = lines.filter((l) => l.type !== 'hunk-header');
    expect(byType[0].content).toBe('hello');
    expect(byType[1].content).toBe('world');
  });
});
