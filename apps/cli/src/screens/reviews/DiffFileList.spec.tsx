import { describe, it, expect } from 'vitest';
import stripAnsi from 'strip-ansi';
import type { DiffFile } from '@kirby/diff';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { renderWithProviders } from '../../test-utils/render-with-providers.js';
import { DiffFileList } from './DiffFileList.js';

// Regression: the PR-comments footer used to render every card with no
// height budget. Once file rows + cards exceeded the pane, Yoga
// squeezed the bordered cards into each other (border soup) and the
// hints row vanished. The footer now windows cards around the selected
// one and clips inside a bounded box, so total output must never
// exceed paneRows.

function makeFile(i: number): DiffFile {
  return {
    filename: `src/file-${i}.ts`,
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
  };
}

function makeThread(i: number, bodyLines = 1): RemoteCommentThread {
  return {
    id: `t${i}`,
    file: null,
    lineStart: null,
    lineEnd: null,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: `t${i}-c1`,
        author: `author-${i}`,
        body: Array.from({ length: bodyLines }, (_, l) => `line ${l}`).join(
          '\n'
        ),
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
  };
}

const PANE_ROWS = 24;
const PANE_COLS = 100;

function renderList(
  overrides: Partial<Parameters<typeof DiffFileList>[0]> = {}
) {
  return renderWithProviders(
    <DiffFileList
      files={Array.from({ length: 20 }, (_, i) => makeFile(i))}
      selectedIndex={0}
      paneRows={PANE_ROWS}
      paneCols={PANE_COLS}
      loading={false}
      error={null}
      showSkipped={false}
      generalComments={Array.from({ length: 8 }, (_, i) => makeThread(i, 3))}
      {...overrides}
    />
  );
}

function frameRows(lastFrame: () => string | undefined): string[] {
  return stripAnsi(lastFrame() ?? '').split('\n');
}

describe('DiffFileList — footer height budget', () => {
  it('never renders more rows than paneRows', () => {
    const { lastFrame } = renderList();
    expect(frameRows(lastFrame).length).toBeLessThanOrEqual(PANE_ROWS);
  });

  it('stays bounded even with long wrapped comment bodies', () => {
    const longBody = 'word '.repeat(120); // wraps to many rows
    const threads = Array.from({ length: 6 }, (_, i) => ({
      ...makeThread(i),
      comments: [{ ...makeThread(i).comments[0]!, body: longBody }],
    }));
    const { lastFrame } = renderList({ generalComments: threads });
    expect(frameRows(lastFrame).length).toBeLessThanOrEqual(PANE_ROWS);
  });

  it('shows a ↓ more indicator when comments are clipped', () => {
    const { lastFrame } = renderList();
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('PR Comments (8)');
    expect(visible).toMatch(/↓ \d+ more/);
  });

  it('scrolls the selected comment card into view', () => {
    // Selection on the last card (index 7): the footer must window
    // down to it and flag the skipped cards above.
    const { lastFrame } = renderList({
      selectedIndex: 27, // 20 files + 7 → last comment card
      selectedCommentIndex: 7,
    });
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('author-7');
    expect(visible).toMatch(/↑ \d+ more/);
    expect(frameRows(lastFrame).length).toBeLessThanOrEqual(PANE_ROWS);
  });

  it('keeps the hints row visible below the footer', () => {
    const { lastFrame } = renderList();
    const rows = frameRows(lastFrame);
    expect(rows.some((r) => r.includes('navigate'))).toBe(true);
  });

  it('keeps at least half the pane for the file list', () => {
    const { lastFrame } = renderList();
    const visible = stripAnsi(lastFrame() ?? '');
    // 20 files, half of available (24 - 4 = 20) → ~10 file rows.
    const fileRowCount = visible
      .split('\n')
      .filter((r) => r.includes('src/file-')).length;
    expect(fileRowCount).toBeGreaterThanOrEqual(6);
  });

  it('gives the footer the whole pane when there are few files', () => {
    const { lastFrame } = renderList({
      files: [makeFile(0)],
      generalComments: Array.from({ length: 3 }, (_, i) => makeThread(i, 1)),
    });
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('author-0');
    expect(visible).toContain('author-2');
    expect(visible).not.toMatch(/[↑↓] \d+ more/);
  });
});
