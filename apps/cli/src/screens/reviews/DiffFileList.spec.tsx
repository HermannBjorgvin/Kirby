import { describe, it, expect } from 'vitest';
import stripAnsi from 'strip-ansi';
import type { DiffFile } from '@kirby/diff';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { renderWithProviders } from '../../test-utils/render-with-providers.js';
import { DiffFileList } from './DiffFileList.js';

// File rows and PR-comment cards render as ONE row-granular virtual
// viewport driven by `scrollRow` — there is no separate file window +
// comments footer. Regression guarded here: cards used to render with
// no height budget, Yoga squeezed them into each other (border soup)
// and the hints row vanished once content exceeded the pane. Total
// output must never exceed paneRows, and any row of any card is
// reachable by scrolling.

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

  it('shows a ↓ rows-below indicator when the stream is clipped', () => {
    const { lastFrame } = renderList();
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toMatch(/↓ \d+ rows below/);
  });

  it('shows the PR Comments heading when scrolled to the section', () => {
    // 20 file rows precede the comments; the heading rides on the
    // first card's span, so scrolling there brings it into view.
    const { lastFrame } = renderList({ scrollRow: 20 });
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('PR Comments (8)');
    expect(visible).toContain('author-0');
  });

  it('keeps the hints row visible below the footer', () => {
    const { lastFrame } = renderList();
    const rows = frameRows(lastFrame);
    expect(rows.some((r) => r.includes('navigate'))).toBe(true);
  });

  it('shows the file rows at the top of the stream at offset 0', () => {
    const { lastFrame } = renderList();
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('src/file-0.ts');
    // Comments live further down the stream, out of the viewport.
    expect(visible).not.toContain('author-7');
  });

  it('shows everything with no indicators when the stream fits', () => {
    const { lastFrame } = renderList({
      files: [makeFile(0)],
      generalComments: Array.from({ length: 2 }, (_, i) => makeThread(i, 1)),
    });
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('src/file-0.ts');
    expect(visible).toContain('author-0');
    expect(visible).toContain('author-1');
    expect(visible).not.toMatch(/[↑↓] \d+ rows/);
  });
});

describe('DiffFileList — unified virtual viewport', () => {
  it('scrolls the file rows out as the viewport moves into the comments', () => {
    // Scrolled to the end of the stream: the last card is visible,
    // the file rows are gone, and skipped rows are flagged above.
    const { lastFrame } = renderList({
      selectedIndex: 27, // 20 files + 7 → last comment card
      selectedCommentIndex: 7,
      scrollRow: 999, // clamped to the max offset internally
    });
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('author-7');
    expect(visible).not.toContain('src/file-0.ts');
    expect(visible).toMatch(/↑ \d+ rows above/);
    expect(frameRows(lastFrame).length).toBeLessThanOrEqual(PANE_ROWS);
  });

  it('reveals deeper rows of a tall card as scrollRow advances', () => {
    // One 30-line comment (36 rows with heading) after a single file
    // row, in an ~18-row viewport: at offset 0 the card top is
    // visible; scrolled to the end, the last body line is visible and
    // the top is not.
    const tall = [makeThread(0, 30)];
    const atTop = renderList({
      files: [makeFile(0)],
      generalComments: tall,
      selectedIndex: 1,
      selectedCommentIndex: 0,
      scrollRow: 0,
    });
    const topVisible = stripAnsi(atTop.lastFrame() ?? '');
    expect(topVisible).toContain('author-0');
    expect(topVisible).toContain('line 0');
    expect(topVisible).not.toContain('line 29');
    expect(topVisible).toMatch(/↓ \d+ rows below/);

    const atBottom = renderList({
      files: [makeFile(0)],
      generalComments: tall,
      selectedIndex: 1,
      selectedCommentIndex: 0,
      scrollRow: 999, // clamped to the max offset internally
    });
    const bottomVisible = stripAnsi(atBottom.lastFrame() ?? '');
    expect(bottomVisible).toContain('line 29');
    expect(bottomVisible).not.toContain('line 0');
    expect(bottomVisible).toMatch(/↑ \d+ rows above/);
    expect(frameRows(atBottom.lastFrame).length).toBeLessThanOrEqual(PANE_ROWS);
  });

  it('stays bounded while a long wrapping reply is being composed', () => {
    // Regression: the reply input's span was a fixed 4 rows, so a
    // buffer wrapping to several lines made the real card taller than
    // its estimate and the stream overflowed the pane budget.
    const { lastFrame } = renderList({
      selectedIndex: 20,
      selectedCommentIndex: 0,
      scrollRow: 20,
      replyingToThreadId: 't0',
      replyBuffer: 'reply word '.repeat(40),
    });
    expect(frameRows(lastFrame).length).toBeLessThanOrEqual(PANE_ROWS);
  });

  it('clips a bottom-edge partial card instead of bleeding past the viewport', () => {
    // Regression: Ink applies only the INNERMOST overflow clip
    // (Output.get uses clips.at(-1), no ancestor intersection), so a
    // per-item slot clip on a card whose slot extends past the body
    // box let the card paint below the viewport — card text overlapped
    // the ↓-indicator and hints rows. Deep rows of the partially
    // visible bottom card must stay hidden.
    const { lastFrame } = renderList({
      files: [makeFile(0)],
      generalComments: [makeThread(0, 2), makeThread(1, 30)],
      scrollRow: 0,
    });
    const visible = stripAnsi(lastFrame() ?? '');
    // The tall second card is partially visible at the bottom edge…
    expect(visible).toContain('author-1');
    // …but rows past the viewport's bottom edge must stay hidden —
    // they used to paint over the ↓-indicator and hints rows below
    // ('line 7'+ landed on the chrome rows).
    expect(visible).not.toContain('line 8');
    expect(frameRows(lastFrame).length).toBeLessThanOrEqual(PANE_ROWS);
  });

  it('keeps frame height stable across scroll positions', () => {
    // Indicator lines are placeholders while clipped, so the frame's
    // row count must not change as the viewport scrolls (the hints row
    // would visibly jump otherwise).
    const rowsAt = (offset: number) =>
      frameRows(renderList({ scrollRow: offset }).lastFrame).length;
    expect(rowsAt(0)).toBe(rowsAt(10));
  });
});
