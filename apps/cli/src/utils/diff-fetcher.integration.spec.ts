import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseUnifiedDiff, renderDiffLines } from '@kirby/diff';
import { interleaveComments, type ReviewComment } from '@kirby/review-comments';

// BG_HIGHLIGHT ANSI code used by comment-renderer
const BG_HIGHLIGHT = '\x1b[48;5;58m';

function makeComment(
  overrides: Partial<ReviewComment> & { id: string }
): ReviewComment {
  return {
    file: 'test.txt',
    lineStart: 1,
    lineEnd: 1,
    severity: 'minor',
    body: 'test comment',
    side: 'RIGHT' as const,
    status: 'draft' as const,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('diff-fetcher integration', () => {
  let repoDir: string;
  const originalCwd = process.cwd();

  beforeAll(() => {
    // Create a temp repo with master + feature branch
    repoDir = mkdtempSync(join(tmpdir(), 'diff-fetcher-test-'));

    execSync('git init', { cwd: repoDir });
    execSync('git config user.email "test@test.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });

    // Create a file with 20 lines on master
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
      '\n'
    );
    writeFileSync(join(repoDir, 'test.txt'), lines);
    execSync('git add test.txt', { cwd: repoDir });
    execSync('git commit -m "initial"', { cwd: repoDir });

    // Create feature branch that modifies lines 15-17
    execSync('git checkout -b feature', { cwd: repoDir });
    const modified = Array.from({ length: 20 }, (_, i) => {
      const n = i + 1;
      if (n >= 15 && n <= 17) return `modified line ${n}`;
      return `line ${n}`;
    }).join('\n');
    execSync(`printf '%s' '${modified}' > test.txt`, { cwd: repoDir });
    execSync('git add test.txt', { cwd: repoDir });
    execSync('git commit -m "modify lines 15-17"', { cwd: repoDir });

    process.chdir(repoDir);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('diff includes full file context so comment-referenced lines are present', async () => {
    // Dynamic import so it runs in the temp repo's cwd
    const { fetchDiffText } = await import('./diff-fetcher.js');
    const diffText = await fetchDiffText('feature', 'master');
    const parsed = parseUnifiedDiff(diffText);
    const diffLines = parsed.get('test.txt');

    expect(diffLines).toBeDefined();
    expect(diffLines!.length).toBeGreaterThan(0);

    // Lines 5-7 should be present in the diff (as context lines)
    const hasLine5 = diffLines!.some((dl) => dl.newLine === 5);
    const hasLine6 = diffLines!.some((dl) => dl.newLine === 6);
    const hasLine7 = diffLines!.some((dl) => dl.newLine === 7);
    expect(hasLine5).toBe(true);
    expect(hasLine6).toBe(true);
    expect(hasLine7).toBe(true);

    // Create a comment on lines 5-7 (far from changed lines 15-17)
    const comments = [
      makeComment({ id: 'c1', lineStart: 5, lineEnd: 7, file: 'test.txt' }),
    ];

    const renderedDiffLines = renderDiffLines(diffLines!, 120);
    const { lines: annotated } = interleaveComments(
      diffLines!,
      renderedDiffLines,
      comments,
      80,
      'c1' // selected
    );

    // Should have BG_HIGHLIGHT on the referenced lines
    const highlightedLines = annotated.filter(
      (l) => l.type === 'diff' && l.rendered.includes(BG_HIGHLIGHT)
    );
    expect(highlightedLines.length).toBe(3);

    // Comment header should NOT be in "out of diff" section
    const outOfDiffMarker = annotated.find(
      (l) =>
        l.type === 'diff' &&
        l.rendered.includes('comments on lines not in diff')
    );
    expect(outOfDiffMarker).toBeUndefined();
  });

  it('comment is placed at correct position when referenced lines are in diff', async () => {
    const { fetchDiffText } = await import('./diff-fetcher.js');
    const diffText = await fetchDiffText('feature', 'master');
    const parsed = parseUnifiedDiff(diffText);
    const diffLines = parsed.get('test.txt')!;

    // Comment on the actually changed lines 15-17
    const comments = [
      makeComment({
        id: 'c1',
        lineStart: 15,
        lineEnd: 17,
        file: 'test.txt',
      }),
    ];

    const renderedDiffLines = diffLines.map((dl) => dl.content);
    const { lines: annotated } = interleaveComments(
      diffLines,
      renderedDiffLines,
      comments,
      80,
      'c1'
    );

    // Should have BG_HIGHLIGHT on 3 lines
    const highlightedLines = annotated.filter(
      (l) => l.type === 'diff' && l.rendered.includes(BG_HIGHLIGHT)
    );
    expect(highlightedLines.length).toBe(3);

    // Comment should not be in "out of diff"
    const outOfDiffMarker = annotated.find(
      (l) =>
        l.type === 'diff' &&
        l.rendered.includes('comments on lines not in diff')
    );
    expect(outOfDiffMarker).toBeUndefined();
  });
});
