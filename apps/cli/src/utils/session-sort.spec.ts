import { describe, it, expect } from 'vitest';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { AgentSession } from '../types.js';
import { sortSessionsByPrId } from './session-sort.js';

function makePrMap(entries: [string, number][]): Map<string, PullRequestInfo> {
  const map = new Map<string, PullRequestInfo>();
  for (const [name, id] of entries) {
    map.set(name, {
      id,
      title: `PR #${id}`,
      sourceBranch: name,
      targetBranch: 'main',
      url: '',
      createdByIdentifier: '',
      createdByDisplayName: '',
    } as PullRequestInfo);
  }
  return map;
}

function sessions(...names: string[]): AgentSession[] {
  return names.map((name) => ({ name, running: false }));
}

describe('sortSessionsByPrId', () => {
  it('sorts sessions by PR ID descending', () => {
    const prMap = makePrMap([
      ['feature-a', 5],
      ['feature-c', 10],
    ]);
    const sorted = sortSessionsByPrId(
      sessions('feature-a', 'feature-b', 'feature-c'),
      prMap
    );
    expect(sorted.map((s) => s.name)).toEqual([
      'feature-c',
      'feature-a',
      'feature-b',
    ]);
  });

  it('puts sessions without PRs at the end', () => {
    const prMap = makePrMap([['has-pr', 1]]);
    const sorted = sortSessionsByPrId(sessions('no-pr', 'has-pr'), prMap);
    expect(sorted[0]!.name).toBe('has-pr');
    expect(sorted[1]!.name).toBe('no-pr');
  });

  it('returns empty array for empty input', () => {
    expect(sortSessionsByPrId([], new Map())).toEqual([]);
  });

  it('does not mutate the original array', () => {
    const original = sessions('a', 'b');
    const prMap = makePrMap([['b', 10]]);
    sortSessionsByPrId(original, prMap);
    expect(original[0]!.name).toBe('a');
  });

  it('preserves insertion order among sessions without PRs', () => {
    const prMap = makePrMap([['has-pr', 1]]);
    const sorted = sortSessionsByPrId(
      sessions('z-no-pr', 'a-no-pr', 'has-pr', 'm-no-pr'),
      prMap
    );
    // has-pr first, then the three PR-less in original order
    expect(sorted.map((s) => s.name)).toEqual([
      'has-pr',
      'z-no-pr',
      'a-no-pr',
      'm-no-pr',
    ]);
  });
});

