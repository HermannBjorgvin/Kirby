import { describe, it, expect } from 'vitest';
import type { SidebarItem } from '../types.js';
import { orderRunningTabs, tabNumberMap, tabDigit } from './running-tabs.js';

function sessionItem(name: string, running = true): SidebarItem {
  return {
    kind: 'session',
    session: { name, running },
    isMerged: false,
  };
}

describe('orderRunningTabs', () => {
  it('returns running sessions sorted by spawn time, ascending', () => {
    const items: SidebarItem[] = [
      sessionItem('alpha'),
      sessionItem('beta'),
      sessionItem('gamma'),
    ];
    const spawnedAt = new Map<string, number>([
      ['alpha', 300],
      ['beta', 100],
      ['gamma', 200],
    ]);

    const ordered = orderRunningTabs(items, (n) => spawnedAt.get(n));

    expect(ordered.map((it) => it.session.name)).toEqual([
      'beta',
      'gamma',
      'alpha',
    ]);
  });

  it('skips non-running sessions and non-session rows', () => {
    const items: SidebarItem[] = [
      sessionItem('alive'),
      sessionItem('dead', false),
      {
        kind: 'orphan-pr',
        pr: {
          id: 1,
          title: 'orphan',
          sourceBranch: 'o',
          targetBranch: 'master',
          url: '',
          createdByIdentifier: '',
          createdByDisplayName: '',
        },
      },
    ];
    const ordered = orderRunningTabs(items, () => 100);
    expect(ordered.map((it) => it.session.name)).toEqual(['alive']);
  });

  it('sessions without a spawn time sort to the end', () => {
    const items: SidebarItem[] = [
      sessionItem('orphan-spawn'),
      sessionItem('first'),
      sessionItem('second'),
    ];
    const spawnedAt = new Map<string, number>([
      ['first', 100],
      ['second', 200],
    ]);
    const ordered = orderRunningTabs(items, (n) => spawnedAt.get(n));
    expect(ordered.map((it) => it.session.name)).toEqual([
      'first',
      'second',
      'orphan-spawn',
    ]);
  });

  it('preserves spawn order across kill+restart (restart bumps to end)', () => {
    // Initial state: a (t=100), b (t=200), c (t=300) → a,b,c.
    // User kills c then restarts it → c gets a fresh spawnedAt (t=400).
    // Expected order: a, b, c (unchanged because c was already last).
    // Now user kills+restarts a → fresh t=500. Expected: b, c, a.
    const items: SidebarItem[] = [
      sessionItem('a'),
      sessionItem('b'),
      sessionItem('c'),
    ];
    const spawnedAt = new Map<string, number>([
      ['b', 200],
      ['c', 400],
      ['a', 500],
    ]);
    const ordered = orderRunningTabs(items, (n) => spawnedAt.get(n));
    expect(ordered.map((it) => it.session.name)).toEqual(['b', 'c', 'a']);
  });
});

describe('tabNumberMap', () => {
  it('maps the first 10 tabs to numbers 1..10', () => {
    const ordered = Array.from({ length: 12 }, (_, i) =>
      sessionItem(`s${i + 1}`)
    ) as Extract<SidebarItem, { kind: 'session' }>[];
    const map = tabNumberMap(ordered);
    expect(map.get('s1')).toBe(1);
    expect(map.get('s9')).toBe(9);
    expect(map.get('s10')).toBe(10);
    expect(map.has('s11')).toBe(false);
    expect(map.has('s12')).toBe(false);
  });
});

describe('tabDigit', () => {
  it('renders 1..9 as themselves and 10 as "0"', () => {
    expect(tabDigit(1)).toBe('1');
    expect(tabDigit(5)).toBe('5');
    expect(tabDigit(9)).toBe('9');
    expect(tabDigit(10)).toBe('0');
  });
});
