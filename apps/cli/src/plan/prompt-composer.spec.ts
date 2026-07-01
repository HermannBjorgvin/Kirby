import { describe, it, expect } from 'vitest';
import type { LocalPlanItem, RemotePlanItem } from './plan-types.js';
import { composePlanPrompt } from './prompt-composer.js';

const remote: RemotePlanItem = {
  kind: 'remote',
  id: 't1',
  file: 'apps/cli/src/DiffViewer.tsx',
  line: 42,
  body: 'This loop re-renders on every keystroke; memoize it.',
  author: 'alice',
  replies: [{ author: 'bob', body: 'agreed, useMemo would fix it' }],
  annotation: 'Wrap in useMemo keyed on annotatedLines.',
};

const local: LocalPlanItem = {
  kind: 'local',
  id: 'd1',
  file: 'libs/review-comments/src/types.ts',
  line: 10,
  body: 'severity should be an enum, not a string union.',
  severity: 'minor',
};

describe('composePlanPrompt', () => {
  it('renders the rich format for a mixed plan', () => {
    expect(composePlanPrompt([remote, local])).toBe(
      [
        'Resolve these PR review comments:',
        '',
        '### 1. apps/cli/src/DiffViewer.tsx:42',
        '@alice: This loop re-renders on every keystroke; memoize it.',
        '  ↳ @bob: agreed, useMemo would fix it',
        'Your note: Wrap in useMemo keyed on annotatedLines.',
        '',
        '### 2. libs/review-comments/src/types.ts:10  [minor]',
        'severity should be an enum, not a string union.',
      ].join('\n')
    );
  });

  it('omits the note line when unannotated', () => {
    const out = composePlanPrompt([{ ...remote, annotation: undefined }]);
    expect(out).not.toContain('Your note:');
  });

  it('renders no reply lines when there are none', () => {
    const out = composePlanPrompt([{ ...remote, replies: [], annotation: undefined }]);
    expect(out).not.toContain('↳');
  });

  it('handles null file/line as a general reference', () => {
    const out = composePlanPrompt([
      { ...remote, file: null, line: null, replies: [], annotation: undefined },
    ]);
    expect(out).toContain('### 1. general');
    expect(out).not.toContain('general:');
  });
});
