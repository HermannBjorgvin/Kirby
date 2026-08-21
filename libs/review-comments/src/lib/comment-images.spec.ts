import { describe, it, expect } from 'vitest';
import { segmentCommentBody, collectImageUrls } from './comment-images.js';
import { estimateBodyRows, buildRowMap } from './comment-renderer.js';

describe('segmentCommentBody', () => {
  it('returns a single text block for plain text', () => {
    expect(segmentCommentBody('hello')).toEqual([
      { type: 'text', text: 'hello' },
    ]);
  });

  it('keeps multi-line text as one block', () => {
    expect(segmentCommentBody('a\nb')).toEqual([
      { type: 'text', text: 'a\nb' },
    ]);
  });

  it('turns a lone image line into an image block', () => {
    expect(segmentCommentBody('![shot](https://x/i.png)')).toEqual([
      { type: 'image', alt: 'shot', url: 'https://x/i.png' },
    ]);
  });

  it('splits text around an image on its own line', () => {
    expect(segmentCommentBody('before\n![a](https://x/i.png)\nafter')).toEqual([
      { type: 'text', text: 'before' },
      { type: 'image', alt: 'a', url: 'https://x/i.png' },
      { type: 'text', text: 'after' },
    ]);
  });

  it('keeps inline text of an image line as its own text block above the image', () => {
    expect(segmentCommentBody('see ![a](https://x/i.png) here')).toEqual([
      { type: 'text', text: 'see  here' },
      { type: 'image', alt: 'a', url: 'https://x/i.png' },
    ]);
  });

  it('emits two image blocks for two images on one line', () => {
    expect(
      segmentCommentBody('![a](https://x/1.png)![b](https://x/2.png)')
    ).toEqual([
      { type: 'image', alt: 'a', url: 'https://x/1.png' },
      { type: 'image', alt: 'b', url: 'https://x/2.png' },
    ]);
  });

  it('preserves blank lines inside text blocks', () => {
    expect(segmentCommentBody('a\n\n![i](https://x/i.png)\nb')).toEqual([
      { type: 'text', text: 'a\n' },
      { type: 'image', alt: 'i', url: 'https://x/i.png' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('supports empty alt text', () => {
    expect(segmentCommentBody('![](https://x/i.png)')).toEqual([
      { type: 'image', alt: '', url: 'https://x/i.png' },
    ]);
  });

  it('strips an optional markdown title from the url', () => {
    expect(segmentCommentBody('![a](https://x/i.png "title")')).toEqual([
      { type: 'image', alt: 'a', url: 'https://x/i.png' },
    ]);
  });

  it('leaves plain links alone', () => {
    expect(segmentCommentBody('[link](https://x)')).toEqual([
      { type: 'text', text: '[link](https://x)' },
    ]);
  });

  it('leaves malformed image markup alone', () => {
    expect(segmentCommentBody('![a](https://x/i.png')).toEqual([
      { type: 'text', text: '![a](https://x/i.png' },
    ]);
  });
});

describe('estimateBodyRows with image layouts', () => {
  const url = 'https://x/i.png';
  const layouts = new Map([[url, { rows: 10, cols: 40 }]]);

  it('is unchanged when no layouts are passed', () => {
    expect(estimateBodyRows(`![a](${url})`, 40)).toBe(1);
  });

  it('counts a laid-out image as its placement rows', () => {
    expect(estimateBodyRows(`![a](${url})`, 40, layouts)).toBe(10);
  });

  it('sums text rows and image rows', () => {
    expect(estimateBodyRows(`intro\n![a](${url})\ntail`, 40, layouts)).toBe(
      1 + 10 + 1
    );
  });

  it('wraps the raw token text for images without a layout', () => {
    // 21-char token hard-wrapped at width 10 = 3 rows
    expect(estimateBodyRows('![a](https://x/9.png)', 10, layouts)).toBe(3);
  });

  it('preserves blank lines in surrounding text', () => {
    expect(estimateBodyRows(`a\n\n![a](${url})\nb`, 40, layouts)).toBe(
      2 + 10 + 1
    );
  });
});

describe('collectImageUrls', () => {
  const thread = (id: string, ...bodies: string[]) =>
    ({
      id,
      comments: bodies.map((body, i) => ({
        id: `${id}-${i}`,
        author: 'a',
        body,
        createdAt: '2026-01-01T00:00:00Z',
      })),
    } as never);

  it('collects urls across threads and replies, deduplicated in order', () => {
    const threads = [
      thread('t1', 'x ![a](https://x/1.png) y', 'reply ![b](https://x/2.png)'),
      thread('t2', '![c](https://x/1.png) again\n![d](https://x/3.png)'),
    ];
    expect(collectImageUrls(threads)).toEqual([
      'https://x/1.png',
      'https://x/2.png',
      'https://x/3.png',
    ]);
  });

  it('returns empty for threads without images', () => {
    expect(collectImageUrls([thread('t', 'no images here')])).toEqual([]);
  });
});

describe('buildRowMap with image layouts', () => {
  const url = 'https://x/shot.png';
  const thread = {
    id: 'T1',
    file: 'a.ts',
    lineStart: 1,
    lineEnd: 1,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: 'c1',
        author: 'a',
        body: `look\n![s](${url})`,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  } as never;
  const lines = [{ type: 'thread-remote', thread }] as never;

  it('adds image rows to the thread card span', () => {
    const base = buildRowMap({
      annotatedLines: lines,
      sectionAnchors: [0],
      contentWidth: 40,
    });
    const withImages = buildRowMap({
      annotatedLines: lines,
      sectionAnchors: [0],
      contentWidth: 40,
      imageLayouts: new Map([[url, { rows: 12, cols: 40 }]]),
    });
    // base body: "look" + wrapped url line = 2 rows; with layout the
    // url line becomes 12 image rows
    expect(withImages.totalRows).toBe(base.totalRows + 11);
  });
});
