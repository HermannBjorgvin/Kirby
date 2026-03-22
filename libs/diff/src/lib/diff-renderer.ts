import type { DiffLine } from './types.js';

// ANSI color codes
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Render diff lines to ANSI-colored strings with a line number gutter.
 */
export function renderDiffLines(lines: DiffLine[], maxWidth: number): string[] {
  const gutterWidth = 9; // "1234:1234 " — 4+1+4
  const contentWidth = Math.max(10, maxWidth - gutterWidth - 2);

  return lines.map((line) => {
    const oldStr =
      line.oldLine != null ? String(line.oldLine).padStart(4) : '    ';
    const newStr =
      line.newLine != null ? String(line.newLine).padStart(4) : '    ';
    const gutter = `${DIM}${oldStr}:${newStr}${RESET} `;

    const truncated =
      line.content.length > contentWidth
        ? line.content.slice(0, contentWidth - 1) + '…'
        : line.content;

    switch (line.type) {
      case 'hunk-header':
        return `${CYAN}${truncated}${RESET}`;
      case 'add':
        return `${gutter}${GREEN}+${truncated}${RESET}`;
      case 'remove':
        return `${gutter}${RED}-${truncated}${RESET}`;
      case 'context':
        return `${gutter}${DIM} ${truncated}${RESET}`;
    }
  });
}
