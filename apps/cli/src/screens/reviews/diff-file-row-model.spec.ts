import { describe, expect, it } from 'vitest';
import type { DiffFile } from '@kirby/diff';
import { fileRowText, statusBadge } from './diff-file-row-model.js';

function file(over: Partial<DiffFile> = {}): DiffFile {
  return {
    filename: 'src/lib/thing.ts',
    status: 'modified',
    additions: 4,
    deletions: 2,
    binary: false,
    ...over,
  };
}

const base = {
  file: file(),
  selected: false,
  maxWidth: 60,
  commentCount: 0,
  hasAnyComments: false,
  depth: 0,
};

describe('statusBadge', () => {
  it('gives every status its own letter, and colours removal red', () => {
    expect(statusBadge('added')).toEqual({ char: 'A', color: 'green' });
    expect(statusBadge('removed')).toEqual({ char: 'D', color: 'red' });
    expect(statusBadge('renamed')).toEqual({ char: 'R', color: 'cyan' });
    expect(statusBadge('modified')).toEqual({ char: 'M', color: 'yellow' });
  });
});

describe('fileRowText', () => {
  it('marks the selected row with a caret and keeps the rest aligned', () => {
    expect(fileRowText({ ...base, selected: true }).prefix).toBe('› ');
    expect(fileRowText(base).prefix).toBe('  ');
  });

  it('shows the full path at the root and only the basename in a tree', () => {
    expect(fileRowText(base).name).toBe('src/lib/thing.ts');
    expect(fileRowText({ ...base, depth: 2 }).name).toBe('thing.ts');
    expect(fileRowText({ ...base, depth: 2 }).indent).toBe('    ');
  });

  it('pads rows with no comments only while some row in the list has them', () => {
    // The badge column is reserved list-wide, otherwise the handful of
    // rows carrying a count would indent their names past the others.
    expect(fileRowText(base).commentPad).toBe('');
    expect(fileRowText({ ...base, hasAnyComments: true }).commentPad).toBe(
      '    '
    );
    const withCount = fileRowText({
      ...base,
      hasAnyComments: true,
      commentCount: 12,
    });
    expect(withCount.commentBadgeStr).toBe('12');
    expect(withCount.commentPad).toBe('  ');
  });

  it('truncates the name to what the fixed columns leave over', () => {
    const long = file({ filename: 'a'.repeat(80) });
    // 60 columns less the caret (2), the status letter and its space
    // (2), " +4 -2" (6) and the trailing column (1) leaves 49.
    const wide = fileRowText({ ...base, file: long, maxWidth: 60 }).name;
    expect(wide).toHaveLength(49);
    expect(wide.endsWith('...')).toBe(true);
    // Reserving the comment badge takes four of those columns away.
    const withBadge = fileRowText({
      ...base,
      file: long,
      maxWidth: 60,
      hasAnyComments: true,
    }).name;
    expect(withBadge).toHaveLength(45);
    const narrow = fileRowText({ ...base, file: long, maxWidth: 40 }).name;
    expect(narrow.length).toBeLessThan(wide.length);
  });

  it('leaves a usable name column however narrow the pane gets', () => {
    const long = file({ filename: 'a'.repeat(80) });
    // The floor keeps the name from collapsing to nothing (or to a
    // negative width, which would make `truncate` slice from the end).
    expect(fileRowText({ ...base, file: long, maxWidth: 4 }).name).toBe(
      'aaaaaaa...'
    );
  });

  it('splits the name column between both halves of a rename', () => {
    const renamed = file({
      filename: 'src/lib/' + 'n'.repeat(60),
      previousFilename: 'src/lib/' + 'o'.repeat(60),
      status: 'renamed',
    });
    // 32 columns leaves 21 for the name, and an odd budget goes to the
    // new name: 10 columns for the old, 11 for the new. Rounding it the
    // other way shifts a character off the name the user is looking for.
    const flat = fileRowText({ ...base, file: renamed, maxWidth: 32 }).name;
    expect(flat).toContain(' → ');
    const [before, after] = flat.split(' → ');
    expect(before).toHaveLength(10);
    expect(after).toHaveLength(11);
    expect(before!.endsWith('...')).toBe(true);
    expect(after!.endsWith('...')).toBe(true);

    // In tree mode both halves are basenames.
    const tree = fileRowText({
      ...base,
      file: renamed,
      depth: 1,
      maxWidth: 200,
    }).name;
    expect(tree).toBe('o'.repeat(60) + ' → ' + 'n'.repeat(60));
  });
});
