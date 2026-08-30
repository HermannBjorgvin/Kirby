import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { composePlanPrompt, type PlanItem } from '@kirby/core/plan';
import {
  checkoutModel,
  planLocation,
  planRows,
  planSummary,
} from './plan-model.js';

function remote(over: Partial<Extract<PlanItem, { kind: 'remote' }>> = {}) {
  return {
    kind: 'remote' as const,
    id: 't1',
    file: 'src/undo.c',
    line: 42,
    body: 'The undo stack is never bounded.',
    author: 'alice',
    replies: [],
    ...over,
  };
}

function local(over: Partial<Extract<PlanItem, { kind: 'local' }>> = {}) {
  return {
    kind: 'local' as const,
    id: 'd1',
    file: 'src/input.c',
    line: 7,
    body: 'Nit: invert this branch.',
    severity: 'minor' as const,
    ...over,
  };
}

/**
 * The prompt's block for item `n` — everything under its `### n.`
 * heading, up to the next heading.
 */
function promptBlock(prompt: string, n: number): string {
  const blocks = prompt.split('\n### ');
  const block = blocks.find((b) => b.startsWith(`${n}.`));
  if (block === undefined) throw new Error(`prompt has no block ${n}`);
  return block;
}

describe('planLocation', () => {
  it('reads as file:line for an inline comment', () => {
    expect(planLocation(remote())).toBe('src/undo.c:42');
  });

  it('drops the colon when the comment has no line', () => {
    expect(planLocation(remote({ line: null }))).toBe('src/undo.c');
  });

  // A general PR comment belongs to no file. The rail already calls
  // that place "Conversation", and a row reading "general:null" is how
  // it looked when the label came from the file field alone.
  it('names the conversation for a comment with no file', () => {
    expect(planLocation(remote({ file: null, line: null }))).toBe(
      'Conversation'
    );
  });
});

describe('planRows', () => {
  it('numbers rows from 1 in the order they were added', () => {
    const rows = planRows([remote(), local()]);
    expect(rows.map((r) => r.index)).toEqual([1, 2]);
    expect(rows.map((r) => r.id)).toEqual(['t1', 'd1']);
  });

  it('attributes a remote row to its author and a local row to its severity', () => {
    const [r, l] = planRows([remote({ author: 'bob' }), local()]);
    expect(r?.author).toBe('bob');
    expect(r?.severity).toBeUndefined();
    expect(l?.severity).toBe('minor');
    expect(l?.author).toBeUndefined();
  });

  it('counts replies so a row can say how much thread it carries', () => {
    const rows = planRows([
      remote({ replies: [{ author: 'bob', body: 'agreed' }] }),
    ]);
    expect(rows[0]?.replyCount).toBe(1);
  });

  it('carries the note through', () => {
    const rows = planRows([remote({ annotation: 'use a ring buffer' })]);
    expect(rows[0]?.note).toBe('use a ring buffer');
  });
});

/**
 * The cart's numbering and the prompt's numbering are produced by two
 * different modules — `planRows` here and `composePlanPrompt` in
 * @kirby/core. If they ever disagree, the user annotates "item 3" and
 * the agent is told to fix a different comment, which nothing else
 * would catch. Tie them together explicitly.
 */
describe('the cart and the prompt agree', () => {
  it('puts each row at the same number the prompt gives it', () => {
    const items: PlanItem[] = [
      remote({ id: 'a', file: 'one.ts', line: 1 }),
      local({ id: 'b', file: 'two.ts', line: 2 }),
      remote({ id: 'c', file: null, line: null }),
    ];
    const prompt = composePlanPrompt(items);
    for (const row of planRows(items)) {
      // The prompt calls a file-less comment "general" where the UI
      // says "Conversation", so the location labels legitimately
      // differ. What has to match is which *comment* landed at that
      // number — compare on the body.
      expect(promptBlock(prompt, row.index)).toContain(row.body);
    }
  });

  it('holds for any plan', () => {
    const item = fc.oneof(
      fc.record({
        kind: fc.constant('remote' as const),
        id: fc.string({ minLength: 1 }),
        file: fc.option(fc.constant('f.ts'), { nil: null }),
        line: fc.option(fc.integer({ min: 1, max: 999 }), { nil: null }),
        body: fc.string({ minLength: 1 }).map((s) => s.replace(/\n/g, ' ')),
        author: fc.constant('a'),
        replies: fc.constant([]),
      }),
      fc.record({
        kind: fc.constant('local' as const),
        id: fc.string({ minLength: 1 }),
        file: fc.constant('g.ts'),
        line: fc.integer({ min: 1, max: 999 }),
        body: fc.string({ minLength: 1 }).map((s) => s.replace(/\n/g, ' ')),
        severity: fc.constantFrom('critical' as const, 'nit' as const),
      })
    );
    fc.assert(
      fc.property(fc.array(item, { minLength: 1, maxLength: 8 }), (items) => {
        const prompt = composePlanPrompt(items as PlanItem[]);
        const rows = planRows(items as PlanItem[]);
        expect(rows).toHaveLength(items.length);
        // Asserting the heading merely exists passes even when the rows
        // are in a different order from the prompt. What has to hold is
        // that row N and prompt block N are the *same comment*.
        for (const row of rows) {
          expect(promptBlock(prompt, row.index)).toContain(row.body);
        }
      })
    );
  });
});

describe('checkoutModel', () => {
  it('offers only a fresh session when nothing is running', () => {
    const m = checkoutModel({ count: 2, agentRunning: false, sending: false });
    expect(m.choices).toEqual(['new-session']);
    expect(m.primary).toBe('new-session');
    expect(m.canSend).toBe(true);
  });

  // Injecting is non-destructive, so it leads — restarting throws away
  // whatever conversation the running agent already has.
  it('leads with injecting when an agent is already running', () => {
    const m = checkoutModel({ count: 2, agentRunning: true, sending: false });
    expect(m.choices).toEqual(['inject', 'new-session']);
    expect(m.primary).toBe('inject');
  });

  it('cannot send an empty plan', () => {
    expect(
      checkoutModel({ count: 0, agentRunning: true, sending: false }).canSend
    ).toBe(false);
  });

  it('cannot send twice while a send is in flight', () => {
    expect(
      checkoutModel({ count: 3, agentRunning: false, sending: true }).canSend
    ).toBe(false);
  });
});

describe('planSummary', () => {
  it('counts the items and how many carry a note', () => {
    expect(planSummary([remote({ annotation: 'x' }), local()])).toEqual({
      count: 2,
      noted: 1,
    });
  });

  it('ignores an annotation that is only whitespace', () => {
    expect(planSummary([remote({ annotation: '   ' })]).noted).toBe(0);
  });
});
