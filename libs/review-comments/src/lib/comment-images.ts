// Markdown image handling for comment bodies.
//
// Comment bodies are plain markdown strings; images only ever arrive as
// inline `![alt](url)` tokens. Rendering treats every image as a block:
// an image token on its own line becomes an image block, and inline
// text sharing the line is kept as its own text line above the image.
// This line-based model keeps row estimation exact — text blocks wrap
// per line, so segmented wrap counts equal whole-body wrap counts.

export type BodyBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; alt: string; url: string };

/** Terminal footprint of a rendered image placement, in cells. */
export interface CommentImageLayout {
  rows: number;
  cols: number;
}

/** url → placement for images that are fetched and ready to render. */
export type CommentImageLayouts = ReadonlyMap<string, CommentImageLayout>;

// `![alt](url)` with an optional quoted markdown title. URLs never
// contain whitespace or `)` in the bodies we see (GitHub / Azure DevOps
// attachment links), which keeps the token boundary unambiguous.
const IMAGE_TOKEN_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Reassemble the raw markdown token for an image block (fallback text). */
export function imageToken(block: { alt: string; url: string }): string {
  return `![${block.alt}](${block.url})`;
}

/**
 * Every distinct image url across the given threads (root comments and
 * replies), in first-appearance order.
 */
export function collectImageUrls(
  threads: readonly { comments: readonly { body: string }[] }[]
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const thread of threads) {
    for (const comment of thread.comments) {
      for (const block of segmentCommentBody(comment.body)) {
        if (block.type === 'image' && !seen.has(block.url)) {
          seen.add(block.url);
          urls.push(block.url);
        }
      }
    }
  }
  return urls;
}

/**
 * Split a comment body into text and block-level image segments.
 * Consecutive text lines merge into one text block joined by newlines;
 * a body without image tokens comes back as a single text block.
 */
export function segmentCommentBody(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  let textLines: string[] = [];

  const flushText = () => {
    if (textLines.length > 0) {
      blocks.push({ type: 'text', text: textLines.join('\n') });
      textLines = [];
    }
  };

  for (const line of body.split('\n')) {
    IMAGE_TOKEN_RE.lastIndex = 0;
    const images: BodyBlock[] = [];
    let remainder = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMAGE_TOKEN_RE.exec(line)) !== null) {
      remainder += line.slice(lastIndex, match.index);
      lastIndex = match.index + match[0].length;
      images.push({ type: 'image', alt: match[1], url: match[2] });
    }

    if (images.length === 0) {
      textLines.push(line);
      continue;
    }

    remainder += line.slice(lastIndex);
    if (remainder.trim().length > 0) textLines.push(remainder.trim());
    flushText();
    blocks.push(...images);
  }

  flushText();
  if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
  return blocks;
}
