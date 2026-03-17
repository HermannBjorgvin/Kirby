import { describe, it, expect } from 'vitest';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { AgentSession } from '../types.js';
import { sortSessionsByPrId, findSortedSessionIndex } from './session-sort.js';

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
});

describe('findSortedSessionIndex', () => {
  it('returns correct index for session with highest PR ID', () => {
    const s = sessions('feature-a', 'feature-b', 'feature-c', 'feature-d');
    const prMap = makePrMap([
      ['feature-a', 5],
      ['feature-c', 10],
      ['feature-d', 15],
    ]);
    // Sorted: feature-d(15), feature-c(10), feature-a(5), feature-b(no PR)
    expect(findSortedSessionIndex(s, prMap, 'feature-d')).toBe(0);
    expect(findSortedSessionIndex(s, prMap, 'feature-c')).toBe(1);
    expect(findSortedSessionIndex(s, prMap, 'feature-a')).toBe(2);
    expect(findSortedSessionIndex(s, prMap, 'feature-b')).toBe(3);
  });

  it('returns -1 for non-existent session', () => {
    expect(
      findSortedSessionIndex(sessions('a'), new Map(), 'nonexistent')
    ).toBe(-1);
  });

  it('reproduces the original bug scenario (orphan PR creation)', () => {
    // Before fix: code used unsorted findIndex which would return 3
    // After fix: sorted findIndex correctly returns 0
    const s = sessions('feature-a', 'feature-b', 'feature-c', 'feature-d');
    const prMap = makePrMap([
      ['feature-a', 5],
      ['feature-c', 10],
      ['feature-d', 15], // newly created from orphan PR
    ]);

    // Bug: unsorted findIndex('feature-d') = 3
    const buggyIndex = s.findIndex((x) => x.name === 'feature-d');
    expect(buggyIndex).toBe(3);

    // Fix: sorted findIndex('feature-d') = 0
    const correctIndex = findSortedSessionIndex(s, prMap, 'feature-d');
    expect(correctIndex).toBe(0);

    // The buggy index would select feature-b in sorted view
    const sorted = sortSessionsByPrId(s, prMap);
    expect(sorted[buggyIndex]!.name).toBe('feature-b'); // wrong!
    expect(sorted[correctIndex]!.name).toBe('feature-d'); // correct!
  });
});
