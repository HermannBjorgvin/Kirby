import { Fragment, memo } from 'react';
import { Text } from 'ink';
import { segmentCommentBody, imageToken } from '@kirby/review-comments';
import { placeholderText } from '@kirby/kitty-graphics';
import { useCommentImagesValue } from '../context/CommentImagesContext.js';

// Comment body with inline images. When kitty graphics is off (the
// default context) this renders the exact same single wrapping <Text>
// as before. When on, the body splits into text blocks and image
// blocks: ready images render as kitty Unicode-placeholder rows (the
// terminal paints the image over those cells), everything else keeps
// its raw `![alt](url)` token text.
export const CommentBody = memo(function CommentBody({
  body,
}: {
  body: string;
}) {
  const { enabled, images } = useCommentImagesValue();
  if (!enabled) return <Text wrap="wrap">{body}</Text>;

  const blocks = segmentCommentBody(body);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'text') {
          return (
            <Text key={i} wrap="wrap">
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
            <Text key={i} wrap="wrap">
              {imageToken(block)}
            </Text>
          );
        }
        // Placeholder lines must stay one terminal row each — never
        // wrap them; clipping a too-narrow pane is fine.
        return (
          <Fragment key={i}>
            {placeholderText(state.id, state.rows, state.cols).map(
              (line, r) => (
                <Text key={r} wrap="truncate-end">
                  {line}
                </Text>
              )
            )}
          </Fragment>
        );
      })}
    </>
  );
});
