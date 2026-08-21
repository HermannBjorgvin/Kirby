import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { estimateCardRows } from '@kirby/review-comments';
import { CommentThreadCard } from './CommentThread.js';
import {
  CommentImagesContext,
  type CommentImagesValue,
} from '../context/CommentImagesContext.js';

const URL = 'https://x/shot.png';
const PLACEHOLDER = String.fromCodePoint(0x10eeee);
const CARD_WIDTH = 80;
const CONTENT_WIDTH = CARD_WIDTH - 4;

function makeThread(body: string): RemoteCommentThread {
  return {
    id: 't1',
    file: 'a.ts',
    lineStart: 1,
    lineEnd: 1,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: 'c0',
        author: 'alice',
        body,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

function imagesValue(
  entries: [string, { id: number; rows: number; cols: number }][]
): CommentImagesValue {
  return {
    enabled: true,
    images: new Map(
      entries.map(([url, e]) => [url, { status: 'ready' as const, ...e }])
    ),
    layouts: new Map(
      entries.map(([url, e]) => [url, { rows: e.rows, cols: e.cols }])
    ),
  };
}

describe('CommentThreadCard image rendering', () => {
  const body = `look at this\n![shot](${URL})`;

  it('renders the raw markdown token without a provider (fallback)', () => {
    const { lastFrame } = render(
      <CommentThreadCard thread={makeThread(body)} maxWidth={CARD_WIDTH} />
    );
    expect(stripAnsi(lastFrame() ?? '')).toContain(`![shot](${URL})`);
    expect(lastFrame() ?? '').not.toContain(PLACEHOLDER);
  });

  it('renders placeholder rows for a ready image', () => {
    const { lastFrame } = render(
      <CommentImagesContext.Provider
        value={imagesValue([[URL, { id: 7, rows: 3, cols: 5 }]])}
      >
        <CommentThreadCard thread={makeThread(body)} maxWidth={CARD_WIDTH} />
      </CommentImagesContext.Provider>
    );
    const frame = lastFrame() ?? '';
    const placeholderLines = frame
      .split('\n')
      .filter((l) => l.includes(PLACEHOLDER));
    expect(placeholderLines).toHaveLength(3);
    // 5 placeholder cells per row
    expect(placeholderLines[0]!.split(PLACEHOLDER).length - 1).toBe(5);
    expect(stripAnsi(frame)).not.toContain(URL);
    expect(stripAnsi(frame)).toContain('look at this');
  });

  it('falls back to the raw token while the image is loading', () => {
    const value: CommentImagesValue = {
      enabled: true,
      images: new Map([[URL, { status: 'loading' }]]),
      layouts: new Map(),
    };
    const { lastFrame } = render(
      <CommentImagesContext.Provider value={value}>
        <CommentThreadCard thread={makeThread(body)} maxWidth={CARD_WIDTH} />
      </CommentImagesContext.Provider>
    );
    expect(stripAnsi(lastFrame() ?? '')).toContain(`![shot](${URL})`);
  });

  it('rendered height matches estimateCardRows with layouts', () => {
    const value = imagesValue([[URL, { id: 7, rows: 6, cols: 30 }]]);
    const thread = makeThread(body);
    const { lastFrame } = render(
      <CommentImagesContext.Provider value={value}>
        <CommentThreadCard thread={thread} maxWidth={CARD_WIDTH} />
      </CommentImagesContext.Provider>
    );
    const real = stripAnsi(lastFrame() ?? '').split('\n').length;
    expect(estimateCardRows(thread, CONTENT_WIDTH, value.layouts)).toBe(real);
  });
});

describe('placeholder clipping (no Ink truncation ellipsis)', () => {
  it('clips placeholder rows to the card width instead of appending …', () => {
    // Placement wider than the card interior (e.g. computed before a
    // terminal resize). Ink's truncate-end would append a colored '…'
    // to every placeholder row — the "mystery dots" — so the rows must
    // be clipped to the available width up front.
    const { lastFrame } = render(
      <CommentImagesContext.Provider
        value={imagesValue([[URL, { id: 7, rows: 2, cols: 200 }]])}
      >
        <CommentThreadCard
          thread={makeThread(`![shot](${URL})`)}
          maxWidth={CARD_WIDTH}
        />
      </CommentImagesContext.Provider>
    );
    const frame = lastFrame() ?? '';
    const placeholderLines = frame
      .split('\n')
      .filter((l) => l.includes(PLACEHOLDER));
    expect(placeholderLines).toHaveLength(2);
    for (const line of placeholderLines) {
      expect(line).not.toContain('…');
      expect(line.split(PLACEHOLDER).length - 1).toBe(CONTENT_WIDTH);
    }
  });

  it('clips reply placeholders 2 columns narrower (reply indent)', () => {
    const thread = makeThread('root text');
    thread.comments.push({
      id: 'c1',
      author: 'bob',
      body: `![shot](${URL})`,
      createdAt: new Date().toISOString(),
    });
    const { lastFrame } = render(
      <CommentImagesContext.Provider
        value={imagesValue([[URL, { id: 7, rows: 1, cols: 200 }]])}
      >
        <CommentThreadCard thread={thread} maxWidth={CARD_WIDTH} />
      </CommentImagesContext.Provider>
    );
    const frame = lastFrame() ?? '';
    const line = frame.split('\n').find((l) => l.includes(PLACEHOLDER));
    expect(line).toBeDefined();
    expect(line).not.toContain('…');
    expect(line!.split(PLACEHOLDER).length - 1).toBe(CONTENT_WIDTH - 2);
  });
});
