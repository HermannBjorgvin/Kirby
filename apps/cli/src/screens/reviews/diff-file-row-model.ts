import { truncate } from '@kirby/core';
import type { DiffFile } from '@kirby/diff';

/** Letter and colour for a file's change status. */
export function statusBadge(status: DiffFile['status']): {
  char: string;
  color: string;
} {
  switch (status) {
    case 'added':
      return { char: 'A', color: 'green' };
    case 'removed':
      return { char: 'D', color: 'red' };
    case 'renamed':
      return { char: 'R', color: 'cyan' };
    case 'copied':
      return { char: 'C', color: 'cyan' };
    case 'changed':
      return { char: 'C', color: 'yellow' };
    default:
      return { char: 'M', color: 'yellow' };
  }
}

export interface FileRowText {
  /** Selection caret, or the two spaces that keep unselected rows aligned. */
  prefix: string;
  /** Tree indent for this row's depth. */
  indent: string;
  /** The count to draw in the comment badge, empty when there is none. */
  commentBadgeStr: string;
  /** Spaces standing in for an absent badge, so names still line up. */
  commentPad: string;
  /** The file name as it should appear, already truncated to fit. */
  name: string;
}

/**
 * The horizontal arithmetic of one file row.
 *
 * Every column left of the name is fixed width, so the name gets what
 * is left over — and a rename gets half of that on each side of the
 * arrow. The comment badge reserves its width across the whole list
 * rather than per row (`hasAnyComments`), because a badge that only
 * some rows carry would otherwise indent those rows' names past the
 * rest.
 */
export function fileRowText(opts: {
  file: DiffFile;
  selected: boolean;
  maxWidth: number;
  commentCount: number;
  hasAnyComments: boolean;
  depth: number;
}): FileRowText {
  const { file, selected, maxWidth, commentCount, hasAnyComments, depth } =
    opts;
  const prefix = selected ? '› ' : '  ';
  const stats = ` +${file.additions} -${file.deletions}`;
  const indent = '  '.repeat(depth);

  // Comment count badge on LEFT side: "N💬 " or padding for alignment
  // Widest realistic badge: "99💬 " = 5 chars (count + emoji + space)
  const badgeWidth = hasAnyComments ? 4 : 0;
  const commentBadgeStr = commentCount > 0 ? `${commentCount}` : '';
  const commentPad = hasAnyComments
    ? ' '.repeat(Math.max(0, badgeWidth - commentBadgeStr.length))
    : '';

  // In tree mode we show only the basename; callers in flat mode pass
  // depth=0 so the full path still renders.
  const displayName =
    depth > 0
      ? file.filename.slice(file.filename.lastIndexOf('/') + 1)
      : file.filename;
  const displayPrev =
    depth > 0 && file.previousFilename
      ? file.previousFilename.slice(file.previousFilename.lastIndexOf('/') + 1)
      : file.previousFilename;

  const nameWidth = Math.max(
    10,
    maxWidth - prefix.length - indent.length - 2 - badgeWidth - stats.length - 1
  );
  const name = displayPrev
    ? `${truncate(displayPrev, Math.floor(nameWidth / 2))} → ${truncate(
        displayName,
        Math.ceil(nameWidth / 2)
      )}`
    : truncate(displayName, nameWidth);

  return { prefix, indent, commentBadgeStr, commentPad, name };
}
