import { describe, it, expect } from 'vitest';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { ReviewComment } from '@kirby/review-comments';
import {
  cardBorderColor,
  collapseBody,
  localHeaderSpans,
  planHintText,
  relativeTime,
  replyHeaderSpans,
  threadHeaderSpans,
  threadHintText,
  type HeaderSpan,
} from './comment-card-model.js';

/** Timestamps are relative to the real clock — relativeTime reads it. */
function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function thread(over: Partial<RemoteCommentThread> = {}): RemoteCommentThread {
  return {
    id: 't1',
    file: 'src/foo.ts',
    lineStart: 10,
    lineEnd: 10,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      { id: 'c1', author: 'alice', body: 'body', createdAt: ago(60_000) },
    ],
    ...over,
  };
}

function draft(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'l1',
    file: 'src/foo.ts',
    lineStart: 1,
    lineEnd: 1,
    side: 'RIGHT',
    severity: 'critical',
    body: 'draft body',
    status: 'draft',
    createdAt: ago(0),
    ...over,
  };
}

const IDLE_THREAD = {
  selected: false,
  replying: false,
  planHint: false,
  inPlan: false,
};
const IDLE_LOCAL = {
  selected: false,
  pendingDelete: false,
  editing: false,
  planHint: false,
  inPlan: false,
};

/** The header as the terminal shows it — every span concatenated. */
function text(spans: HeaderSpan[]): string {
  return spans.map((s) => s.text).join('');
}

function span(spans: HeaderSpan[], key: string): HeaderSpan | undefined {
  return spans.find((s) => s.key === key);
}

describe('relativeTime', () => {
  const cases: [number, string][] = [
    [0, 'just now'],
    [59_000, 'just now'],
    [60_000, '1m ago'],
    [59 * 60_000, '59m ago'],
    [60 * 60_000, '1h ago'],
    [23 * 3_600_000, '23h ago'],
    [24 * 3_600_000, '1d ago'],
    [10 * 24 * 3_600_000, '10d ago'],
  ];
  it.each(cases)('%dms ago → %s', (elapsed, expected) => {
    expect(relativeTime(new Date(Date.now() - elapsed).toISOString())).toBe(
      expected
    );
  });
});

describe('cardBorderColor', () => {
  it('uses the caller-supplied selection tint when selected', () => {
    // The two cards select in different colours, so the tint is the
    // caller's to pick — this function only decides when it applies.
    expect(
      cardBorderColor({ selected: true, inPlan: false, selectedColor: 'cyan' })
    ).toBe('cyan');
    expect(
      cardBorderColor({
        selected: true,
        inPlan: false,
        selectedColor: 'yellow',
      })
    ).toBe('yellow');
  });

  it('lets selection win over plan membership', () => {
    expect(
      cardBorderColor({ selected: true, inPlan: true, selectedColor: 'cyan' })
    ).toBe('cyan');
  });

  it('tints an unselected in-plan card green', () => {
    expect(
      cardBorderColor({ selected: false, inPlan: true, selectedColor: 'cyan' })
    ).toBe('green');
  });

  it('leaves an idle card gray', () => {
    expect(
      cardBorderColor({ selected: false, inPlan: false, selectedColor: 'cyan' })
    ).toBe('gray');
  });
});

describe('planHintText', () => {
  it('offers to add a comment that is not in the plan', () => {
    expect(planHintText(false)).toBe(' [a/A]dd to draft plan');
  });

  it('offers remove and annotate once it is in the plan', () => {
    expect(planHintText(true)).toBe(' [a] remove [A] annotate');
  });
});

describe('threadHintText', () => {
  it('offers resolve on an open, resolvable thread', () => {
    expect(
      threadHintText(
        { canResolve: true, isResolved: false },
        { planHint: false, inPlan: false }
      )
    ).toBe('  [r]eply [v]resolve');
  });

  it('offers reopen on a resolved thread', () => {
    expect(
      threadHintText(
        { canResolve: true, isResolved: true },
        { planHint: false, inPlan: false }
      )
    ).toBe('  [r]eply [v]reopen');
  });

  it('omits [v] entirely when the thread cannot be resolved', () => {
    // Issue comments have no resolve endpoint; offering the key would
    // advertise something that does nothing.
    expect(
      threadHintText(
        { canResolve: false, isResolved: false },
        { planHint: false, inPlan: false }
      )
    ).toBe('  [r]eply');
  });

  it('appends the plan hint only when the consumer handles it', () => {
    expect(
      threadHintText(
        { canResolve: false, isResolved: false },
        { planHint: true, inPlan: false }
      )
    ).toBe('  [r]eply [a/A]dd to draft plan');
    expect(
      threadHintText(
        { canResolve: false, isResolved: false },
        { planHint: true, inPlan: true }
      )
    ).toBe('  [r]eply [a] remove [A] annotate');
  });
});

describe('threadHeaderSpans', () => {
  it('has nothing to draw for a thread with no comments', () => {
    expect(threadHeaderSpans(thread({ comments: [] }), IDLE_THREAD)).toEqual(
      []
    );
  });

  it('leads with the author and their timestamp', () => {
    const spans = threadHeaderSpans(thread(), IDLE_THREAD);
    expect(spans.map((s) => s.key)).toEqual(['author', 'time']);
    expect(span(spans, 'author')).toMatchObject({
      text: 'alice',
      bold: true,
      color: 'blue',
    });
    expect(span(spans, 'time')?.text).toMatch(/^ · \d+m ago$/);
  });

  it('recolours the author to match the selection tint', () => {
    const spans = threadHeaderSpans(thread(), {
      ...IDLE_THREAD,
      selected: true,
    });
    expect(span(spans, 'author')?.color).toBe('cyan');
  });

  it('marks resolved threads green and outdated ones dim', () => {
    const spans = threadHeaderSpans(
      thread({ isResolved: true, isOutdated: true }),
      IDLE_THREAD
    );
    expect(span(spans, 'resolved')).toMatchObject({
      text: ' ✓ resolved',
      color: 'green',
    });
    expect(span(spans, 'outdated')).toMatchObject({
      text: ' (outdated)',
      dim: true,
    });
    // Order matters: the state reads left to right after the timestamp.
    expect(spans.map((s) => s.key)).toEqual([
      'author',
      'time',
      'resolved',
      'outdated',
    ]);
  });

  it('shows action hints only on the selected card', () => {
    expect(
      span(threadHeaderSpans(thread(), IDLE_THREAD), 'hints')
    ).toBeUndefined();
    const spans = threadHeaderSpans(thread(), {
      ...IDLE_THREAD,
      selected: true,
    });
    expect(span(spans, 'hints')).toMatchObject({
      text: '  [r]eply [v]resolve',
      dim: true,
    });
  });

  it('replaces the hints with the reply banner while composing', () => {
    const spans = threadHeaderSpans(thread(), {
      ...IDLE_THREAD,
      selected: true,
      replying: true,
    });
    expect(span(spans, 'hints')).toBeUndefined();
    expect(span(spans, 'mode')).toMatchObject({
      text: '  REPLY',
      color: 'cyan',
    });
    expect(text(spans)).toContain(' [enter] send · [esc] cancel');
  });
});

describe('replyHeaderSpans', () => {
  it('never takes the selection tint — only the root comment does', () => {
    const spans = replyHeaderSpans({ author: 'bob', createdAt: ago(0) });
    expect(spans.map((s) => s.color)).toEqual(['blue', undefined]);
    expect(text(spans)).toBe('bob · just now');
  });
});

describe('localHeaderSpans', () => {
  it('colours the severity tag by severity', () => {
    const colorOf = (severity: string) =>
      span(
        localHeaderSpans(
          draft({ severity: severity as ReviewComment['severity'] }),
          IDLE_LOCAL
        ),
        'severity'
      );
    expect(colorOf('critical')).toMatchObject({
      text: '[critical]',
      color: 'red',
      bold: true,
    });
    expect(colorOf('major')?.color).toBe('yellow');
    expect(colorOf('minor')?.color).toBe('cyan');
    expect(colorOf('nit')?.color).toBe('gray');
    expect(colorOf('something-else')?.color).toBe('gray');
  });

  it('marks a comment that is being posted, and one that landed', () => {
    expect(
      span(localHeaderSpans(draft({ status: 'posting' }), IDLE_LOCAL), 'status')
    ).toMatchObject({ text: ' ⏳', color: 'yellow' });
    expect(
      span(localHeaderSpans(draft({ status: 'posted' }), IDLE_LOCAL), 'status')
    ).toMatchObject({ text: ' ✓', color: 'green' });
  });

  it('leaves an unposted draft unmarked', () => {
    expect(
      span(localHeaderSpans(draft({ status: 'draft' }), IDLE_LOCAL), 'status')
    ).toBeUndefined();
  });

  it('shows action hints only on a selected, idle card', () => {
    expect(
      span(localHeaderSpans(draft(), IDLE_LOCAL), 'hints')
    ).toBeUndefined();
    expect(
      span(
        localHeaderSpans(draft(), { ...IDLE_LOCAL, selected: true }),
        'hints'
      )
    ).toMatchObject({ text: '  [e]dit [x]delete [p]ost', dim: true });
  });

  it('appends the plan hint to the action hints when asked', () => {
    const spans = localHeaderSpans(draft(), {
      ...IDLE_LOCAL,
      selected: true,
      planHint: true,
      inPlan: true,
    });
    expect(span(spans, 'hints')?.text).toBe(
      '  [e]dit [x]delete [p]ost [a] remove [A] annotate'
    );
  });

  it('drops the action hints while the delete prompt is up', () => {
    const spans = localHeaderSpans(draft(), {
      ...IDLE_LOCAL,
      selected: true,
      pendingDelete: true,
    });
    expect(span(spans, 'hints')).toBeUndefined();
    expect(span(spans, 'delete')).toMatchObject({
      text: '  Delete? [y]es [n]o',
      color: 'red',
    });
  });

  it('drops the action hints while editing, and says so instead', () => {
    const spans = localHeaderSpans(draft(), {
      ...IDLE_LOCAL,
      selected: true,
      editing: true,
    });
    expect(span(spans, 'hints')).toBeUndefined();
    expect(span(spans, 'mode')).toMatchObject({
      text: '  EDITING',
      color: 'cyan',
    });
    expect(text(spans)).toContain(' [esc] save · [ctrl+c] cancel');
  });
});

describe('collapseBody', () => {
  const SIX = 'one\ntwo\nthree\nfour\nfive\nsix';

  it('caps an unselected body and counts what it hid', () => {
    expect(collapseBody(SIX, false)).toEqual({
      lines: ['one', 'two', 'three', 'four'],
      hiddenCount: 2,
    });
  });

  it('shows the whole body once expanded', () => {
    expect(collapseBody(SIX, true).lines).toHaveLength(6);
    expect(collapseBody(SIX, true).hiddenCount).toBe(0);
  });

  it('hides nothing when the body exactly fills the cap', () => {
    // Off-by-one guard: 4 lines must not report "… 0 more lines".
    expect(collapseBody('a\nb\nc\nd', false)).toEqual({
      lines: ['a', 'b', 'c', 'd'],
      hiddenCount: 0,
    });
  });

  it('keeps blank lines as lines', () => {
    // A blank line still costs a row, so it counts towards the cap.
    expect(collapseBody('a\n\n\n\nb', false)).toEqual({
      lines: ['a', '', '', ''],
      hiddenCount: 1,
    });
  });
});
