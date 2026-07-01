import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { PlanCheckoutPane } from './PlanCheckoutPane.js';
import type { LocalPlanItem, RemotePlanItem } from '../../plan/plan-types.js';

const remote: RemotePlanItem = {
  kind: 'remote',
  id: 't1',
  file: 'apps/cli/src/DiffViewer.tsx',
  line: 42,
  body: 'memoize the loop',
  author: 'alice',
  replies: [],
  annotation: 'use useMemo',
};

const local: LocalPlanItem = {
  kind: 'local',
  id: 'd1',
  file: 'types.ts',
  line: 10,
  body: 'make severity an enum',
  severity: 'minor',
};

describe('PlanCheckoutPane', () => {
  it('lists items with a checkbox and title count', () => {
    const { lastFrame } = render(
      <PlanCheckoutPane items={[remote, local]} selectedIndex={0} paneCols={80} />
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Plan Checkout (2)');
    expect(out).toContain('[x]');
    expect(out).toContain('DiffViewer.tsx:42');
    expect(out).toContain('[minor]');
  });

  it('shows the annotation with a ✎ marker when present', () => {
    const { lastFrame } = render(
      <PlanCheckoutPane items={[remote]} selectedIndex={0} paneCols={80} />
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('✎');
    expect(out).toContain('use useMemo');
  });

  it('renders the note composer for the annotating item', () => {
    const { lastFrame } = render(
      <PlanCheckoutPane
        items={[remote]}
        selectedIndex={0}
        paneCols={80}
        annotatingPlanKey="remote:t1"
        annotationBuffer="typing"
      />
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('note typing');
  });

  it('renders the inject-vs-restart choice when a target is set', () => {
    const { lastFrame } = render(
      <PlanCheckoutPane
        items={[remote]}
        selectedIndex={0}
        paneCols={80}
        target="inject"
      />
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Inject into it');
    expect(out).toContain('Restart with plan');
  });

  it('shows an empty state', () => {
    const { lastFrame } = render(
      <PlanCheckoutPane items={[]} selectedIndex={0} paneCols={80} />
    );
    expect(stripAnsi(lastFrame() ?? '')).toContain('plan is empty');
  });
});
