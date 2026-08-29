import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { SidebarItem } from '@kirby/core';
import {
  buildSidebarRows,
  getSectionKey,
  rowIcon,
  sidebarRowHeights,
  sidebarScrollWindow,
  type RenderRow,
} from './sidebar-model.js';

function pr(over: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    title: 'Add a thing',
    sourceBranch: 'feature/thing',
    targetBranch: 'main',
    url: 'https://example.test/1',
    createdByIdentifier: 'someone',
    createdByDisplayName: 'Someone',
    ...over,
  };
}

function session(over: Partial<SidebarItem & { kind: 'session' }> = {}) {
  return {
    kind: 'session',
    session: { name: 'wt', running: false },
    isMerged: false,
    ...over,
  } as SidebarItem;
}

describe('getSectionKey', () => {
  it('files a worktree by its pull request, not by its kind', () => {
    expect(getSectionKey(session())).toBe('worktrees');
    expect(getSectionKey(session({ pr: pr() }))).toBe('pull-requests');
    expect(getSectionKey(session({ pr: pr({ isDraft: true }) }))).toBe(
      'draft-pull-requests'
    );
  });

  it('files a review PR under the category it was sorted into', () => {
    expect(
      getSectionKey({ kind: 'review-pr', pr: pr(), category: 'needs-review' })
    ).toBe('needs-review');
    expect(
      getSectionKey({ kind: 'review-pr', pr: pr(), category: 'approved' })
    ).toBe('approved');
  });

  it('sends a draft orphan PR to the draft section', () => {
    expect(getSectionKey({ kind: 'orphan-pr', pr: pr() })).toBe(
      'pull-requests'
    );
    expect(
      getSectionKey({ kind: 'orphan-pr', pr: pr({ isDraft: true }) })
    ).toBe('draft-pull-requests');
  });
});

describe('buildSidebarRows', () => {
  const items: SidebarItem[] = [
    session({ session: { name: 'a', running: false } }),
    session({ session: { name: 'b', running: false } }),
    { kind: 'orphan-pr', pr: pr({ id: 7 }) },
  ];

  it('opens each section once and keeps the item indexes intact', () => {
    const rows = buildSidebarRows(items);
    expect(
      rows.map((r) => (r.type === 'header' ? r.key : r.itemIndex))
    ).toEqual(['worktrees', 0, 1, 'pull-requests', 2]);
  });

  it('counts the whole section on its header, not the run it opens', () => {
    const headers = buildSidebarRows(items).filter((r) => r.type === 'header');
    expect(headers.map((h) => ({ key: h.key, count: h.count }))).toEqual([
      { key: 'worktrees', count: 2 },
      { key: 'pull-requests', count: 1 },
    ]);
  });

  it('marks only the first header first, so only it loses its top margin', () => {
    const headers = buildSidebarRows(items).filter((r) => r.type === 'header');
    expect(headers.map((h) => h.first)).toEqual([true, false]);
  });

  it('emits nothing for an empty list', () => {
    expect(buildSidebarRows([])).toEqual([]);
  });
});

describe('sidebarRowHeights', () => {
  it('grows a session row for its conflict count and its PR badge', () => {
    const rows = buildSidebarRows([
      session({ session: { name: 'plain', running: false } }),
      session({ session: { name: 'clash', running: false }, conflictCount: 3 }),
      session({ session: { name: 'clean', running: false }, conflictCount: 0 }),
    ]);
    // Header first, then the three session rows.
    expect(sidebarRowHeights(rows, false).slice(1)).toEqual([1, 2, 1]);
    // With a VCS configured every session row also carries a badge line
    // — "(no PR)" when there is no pull request.
    expect(sidebarRowHeights(rows, true).slice(1)).toEqual([2, 3, 2]);
  });

  it('gives a review row a line more than an orphan row for its author', () => {
    const rows = buildSidebarRows([
      { kind: 'orphan-pr', pr: pr({ id: 1 }) },
      { kind: 'review-pr', pr: pr({ id: 2 }), category: 'needs-review' },
    ]);
    expect(
      sidebarRowHeights(rows, true).filter((_, i) => i !== 0 && i !== 2)
    ).toEqual([2, 3]);
  });

  it('charges a section header for the blank line above it, except the first', () => {
    const rows = buildSidebarRows([session(), { kind: 'orphan-pr', pr: pr() }]);
    const headers = rows
      .map((r, i) => [r, sidebarRowHeights(rows, false)[i]] as const)
      .filter(([r]) => r.type === 'header')
      .map(([, h]) => h);
    expect(headers).toEqual([1, 2]);
  });
});

describe('sidebarScrollWindow', () => {
  /** `n` item rows, each `height` lines tall. */
  function uniform(n: number, height: number) {
    const rows: RenderRow[] = Array.from({ length: n }, (_, i) => ({
      type: 'item',
      item: session({ session: { name: `s${i}`, running: false } }),
      itemIndex: i,
    }));
    return { rows, rowHeights: rows.map(() => height) };
  }

  it('shows everything, with no markers, when it all fits', () => {
    const { rows, rowHeights } = uniform(4, 1);
    expect(
      sidebarScrollWindow({
        rows,
        rowHeights,
        selectedIndex: 0,
        availableLines: 10,
      })
    ).toEqual({
      fullyVisibleRows: rows,
      gap: 0,
      aboveCount: 0,
      belowCount: 0,
    });
  });

  it('reports what is hidden on each side of the window', () => {
    const { rows, rowHeights } = uniform(20, 1);
    const win = sidebarScrollWindow({
      rows,
      rowHeights,
      selectedIndex: 10,
      availableLines: 8, // 6 usable once the two markers are reserved
    });
    expect(win.fullyVisibleRows).toHaveLength(6);
    expect(win.aboveCount + win.fullyVisibleRows.length + win.belowCount).toBe(
      20
    );
    expect(win.aboveCount).toBeGreaterThan(0);
  });

  it('keeps the selected row inside the window when rows differ in height', () => {
    // Short rows at the top, tall ones below. Centring by index alone
    // sizes the window off the short rows, so the slice starting there
    // holds only two of the tall ones and the cursor falls past its
    // bottom edge — the second pass is what slides it back into view.
    const { rows } = uniform(30, 1);
    const rowHeights = rows.map((_, i) => (i < 10 ? 1 : 5));
    const win = sidebarScrollWindow({
      rows,
      rowHeights,
      selectedIndex: 20,
      availableLines: 14,
    });
    const shown = win.fullyVisibleRows.flatMap((r) =>
      r.type === 'item' ? [r.itemIndex] : []
    );
    expect(shown).toContain(20);
  });

  it('never spends more lines on rows than the budget allows', () => {
    const { rows } = uniform(30, 1);
    const rowHeights = rows.map((_, i) => (i % 3 === 0 ? 3 : 1));
    const availableLines = 14;
    const win = sidebarScrollWindow({
      rows,
      rowHeights,
      selectedIndex: 20,
      availableLines,
    });
    const used = win.fullyVisibleRows.reduce(
      (sum, r) => sum + rowHeights[rows.indexOf(r)]!,
      0
    );
    expect(used + win.gap).toBe(availableLines - 2);
  });
});

describe('rowIcon', () => {
  it('shows the selection ring whether or not an agent is running', () => {
    expect(rowIcon(true, true)).toEqual({ icon: '◉', color: 'cyan' });
    expect(rowIcon(true, false)).toEqual({ icon: '◎', color: 'cyan' });
  });

  it('shows a filled green dot only for a running unselected row', () => {
    expect(rowIcon(false, true)).toEqual({ icon: '●', color: 'green' });
    expect(rowIcon(false, false)).toEqual({ icon: '○', color: 'gray' });
  });

  it('reads a row that cannot run an agent as not running', () => {
    // A pull request with no worktree has no `running` at all.
    expect(rowIcon(false, undefined)).toEqual({ icon: '○', color: 'gray' });
    expect(rowIcon(true, undefined)).toEqual({ icon: '◎', color: 'cyan' });
  });
});
