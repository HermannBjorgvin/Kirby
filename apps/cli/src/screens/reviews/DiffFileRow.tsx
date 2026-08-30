import { Text } from 'ink';
import type { DiffFile } from '@kirby/diff';
import { fileRowText, statusBadge } from './diff-file-row-model.js';

/** One changed file: status letter, optional comment count, name, stats. */
export function FileRow({
  file,
  selected,
  maxWidth,
  commentCount,
  hasAnyComments,
  depth = 0,
}: {
  file: DiffFile;
  selected: boolean;
  maxWidth: number;
  commentCount: number;
  hasAnyComments: boolean;
  depth?: number;
}) {
  const badge = statusBadge(file.status);
  const { prefix, indent, commentBadgeStr, commentPad, name } = fileRowText({
    file,
    selected,
    maxWidth,
    commentCount,
    hasAnyComments,
    depth,
  });

  return (
    <Text>
      <Text color={selected ? 'cyan' : undefined}>{prefix}</Text>
      <Text>{indent}</Text>
      <Text color={badge.color}>{badge.char}</Text>{' '}
      {commentCount > 0 && <Text color="yellow">{commentBadgeStr} </Text>}
      {commentCount === 0 && hasAnyComments && <Text>{commentPad}</Text>}
      <Text bold={selected}>{name}</Text>
      <Text color="green"> +{file.additions}</Text>
      <Text color="red"> -{file.deletions}</Text>
    </Text>
  );
}

/** A directory heading in tree mode. */
export function DirRow({ name, depth }: { name: string; depth: number }) {
  const indent = '  '.repeat(depth);
  return (
    <Text dimColor>
      {'  '}
      {indent}
      {name}/
    </Text>
  );
}
