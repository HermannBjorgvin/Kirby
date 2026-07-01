import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { PlanIndicatorContent } from './PlanIndicator.js';
import type { RemotePlanItem } from '../plan/plan-types.js';

function remote(id: string, annotation?: string): RemotePlanItem {
  return {
    kind: 'remote',
    id,
    file: `src/${id}.ts`,
    line: 1,
    body: `body ${id}`,
    author: 'a',
    replies: [],
    ...(annotation ? { annotation } : {}),
  };
}

describe('PlanIndicatorContent', () => {
  it('shows the count and item lines', () => {
    const out = stripAnsi(
      render(<PlanIndicatorContent items={[remote('a'), remote('b')]} />)
        .lastFrame() ?? ''
    );
    expect(out).toContain('Plan (2)');
    expect(out).toContain('a.ts');
    expect(out).toContain('b.ts');
  });

  it('marks annotated items with ✎ and plain items with •', () => {
    const out = stripAnsi(
      render(
        <PlanIndicatorContent items={[remote('a', 'my note'), remote('b')]} />
      ).lastFrame() ?? ''
    );
    expect(out).toContain('✎');
    expect(out).toContain('•');
  });

  it('caps at 5 rows with a +N more line', () => {
    const out = stripAnsi(
      render(
        <PlanIndicatorContent
          items={Array.from({ length: 8 }, (_, i) => remote(`x${i}`))}
        />
      ).lastFrame() ?? ''
    );
    expect(out).toContain('Plan (8)');
    expect(out).toContain('+3 more');
  });
});
