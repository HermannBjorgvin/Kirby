import { Fragment, memo } from 'react';
import { Text } from 'ink';
import { segmentCommentBody, imageToken } from '@kirby/review-comments';
import { placeholderText } from '@kirby/kitty-graphics';
import { useCommentImagesValue } from '../context/CommentImagesContext.js';

interface CommentProseProps {
  /** The prose of a comment body — badge + signature already lifted out. */
  body: string;
  /**
   * Interior cell width available to the body. Placeholder rows are
   * clipped to it up front so Ink's `truncate-end` never appends a
   * coloured '…' over the image when a placement is wider than its
   * card (after a terminal resize, or in the reply column which is 2
   * cols narrower). Undefined = no clip (flex panes).
   */
  width?: number;
}

/**
 * A comment body's prose, with inline `![alt](url)` images rendered as
 * kitty Unicode-placeholder rows when the terminal supports graphics
 * and the image has finished loading.
 *
 * Outside a `CommentImagesContext` provider (the default) this is a
 * single `<Text wrap="wrap">` — byte-identical to the pre-feature
 * render. An image whose fetch is still running, or has failed, keeps
 * its raw markdown token so nothing disappears.
 */
export const CommentProse = memo(function CommentProse({
  body,
  width,
}: CommentProseProps) {
  const { enabled, images } = useCommentImagesValue();
  if (!enabled) return <Text wrap="wrap">{body}</Text>;

  return (
    <>
      {segmentCommentBody(body).map((block) => {
        if (block.type === 'text') {
          // Segmentation merges consecutive text lines, so two text
          // blocks are never adjacent — the text itself is a stable key.
          return (
            <Text key={`t:${block.text}`} wrap="wrap">
              {block.text}
            </Text>
          );
        }
        const state = images.get(block.url);
        if (
          state?.status !== 'ready' ||
          state.id === undefined ||
          state.rows === undefined ||
          state.cols === undefined
        ) {
          return (
            <Text key={`i:${block.url}`} wrap="wrap">
              {imageToken(block)}
            </Text>
          );
        }
        const cols =
          width !== undefined ? Math.min(state.cols, width) : state.cols;
        return (
          <Fragment key={`i:${block.url}`}>
            {placeholderText(state.id, state.rows, cols).map((line) => (
              // Each row carries a distinct row diacritic, so the line
              // string is unique within the placement.
              <Text key={line} wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Fragment>
        );
      })}
    </>
  );
});
