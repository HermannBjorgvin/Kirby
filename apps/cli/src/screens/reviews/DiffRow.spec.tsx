import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { DiffRow } from './DiffRow.js';
import type { DiffLine } from '@kirby/diff';

// Regression guard for the content-mangling bug reported by the user:
// long TypeScript lines rendered next to each other appeared to have
// content from one line glued to another (e.g. `&&duction'`). We test
// that for a column budget of 120 cols, each DiffRow renders its
// content in isolation and doesn't leak from adjacent rows.

function tsLine(oldLine: number, content: string): DiffLine {
  return {
    type: 'remove',
    content,
    oldLine,
  };
}

describe('DiffRow — content boundary', () => {
  const scenarios = [
    {
      name: 'short line passes through unchanged',
      line: tsLine(1, 'readonly rootPage = toSignal(this.rootPage$);'),
      paneCols: 120,
    },
    {
      name: 'paren + call-signature line',
      line: tsLine(2, "    startWith('/production'),"),
      paneCols: 120,
    },
    {
      name: 'very long chained call',
      line: tsLine(
        3,
        "        map((event) => (event as NavigationEnd).url.split('?')[0]),"
      ),
      paneCols: 120,
    },
    {
      name: 'template literal + compare',
      line: tsLine(4, '        currentPath !== `/${rootPage}` &&'),
      paneCols: 120,
    },
    {
      name: 'endsWith string arg — "&&duction" in rendered output would be the bug',
      line: tsLine(5, "        !currentPath.endsWith('/production') &&"),
      paneCols: 120,
    },
  ];

  for (const { name, line, paneCols } of scenarios) {
    it(name, () => {
      const { lastFrame } = render(
        <DiffRow
          line={line}
          highlighted={false}
          language="typescript"
          paneCols={paneCols}
        />
      );
      const visible = stripAnsi(lastFrame() ?? '');
      // The visible text must contain exactly the source line's content
      // (modulo leading gutter/prefix), nothing more.
      expect(visible).toContain(line.content.trim().slice(0, 30));
      // No stray fragments from unrelated source lines should appear.
      expect(visible).not.toMatch(/&&duction'/);
      // The visible line should fit in paneCols — this catches the
      // Ink-doesn't-truncate-ANSI case.
      const lines = visible.split('\n');
      for (const l of lines) {
        expect(l.length).toBeLessThanOrEqual(paneCols + 2); // +2 slack for trailing space
      }
    });
  }

  it('stacked rows do not leak content into each other', () => {
    // Simulates the real diff-viewer: multiple DiffRows in a column
    // Box. Catches bugs where Ink layout leaks characters between
    // adjacent flex rows (the `&&duction'` / `,d,` pattern).
    const lines: DiffLine[] = [
      tsLine(
        117,
        "        map((event) => (event as NavigationEnd).url.split('?')[0]),"
      ),
      tsLine(118, "        startWith(this.router.url.split('?')[0]),"),
      tsLine(134, "        !currentPath.endsWith('/production') &&"),
      tsLine(135, '        currentPath !== `/${rootPage}` &&'),
    ];
    const tree = (
      <>
        {lines.map((l, i) => (
          <DiffRow
            key={i}
            line={l}
            highlighted={false}
            language="typescript"
            paneCols={100}
          />
        ))}
      </>
    );
    const { lastFrame } = render(tree);
    const visible = stripAnsi(lastFrame() ?? '');
    const rendered = visible.split('\n');
    // Each rendered row should contain the exact source content once,
    // with no fragments from other lines bleeding in.
    expect(rendered.some((r) => r.includes("('/production'),"))).toBe(false); // no `,,` duplicate
    expect(rendered.some((r) => r.includes('&&duction'))).toBe(false); // bug signature
    // Each row fits within its pane
    for (const r of rendered) {
      expect(r.length).toBeLessThanOrEqual(102);
    }
  });

  it('narrow pane truncates with ellipsis', () => {
    const line = tsLine(
      1,
      "        map((event) => (event as NavigationEnd).url.split('?')[0]),"
    );
    const { lastFrame } = render(
      <DiffRow
        line={line}
        highlighted={false}
        language="typescript"
        paneCols={40}
      />
    );
    const visible = stripAnsi(lastFrame() ?? '');
    // Visible width within budget
    for (const l of visible.split('\n')) {
      expect(l.length).toBeLessThanOrEqual(42);
    }
    // Truncation mark present
    expect(visible).toContain('…');
  });
});
