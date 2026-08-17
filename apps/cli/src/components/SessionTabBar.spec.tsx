import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { SidebarItem, AgentSession } from '../types.js';
import type { SidebarContextValue } from '../context/SidebarContext.js';
import type { SessionDataContextValue } from '../context/SessionContext.js';

// Stub the hooks/registries the component reads. Each test installs
// its own values before rendering — this avoids spinning up the full
// provider tree (which pulls live git state, PR fetching, etc.).
let sidebarValue: Partial<SidebarContextValue> = {};
let sessionValue: Partial<SessionDataContextValue> = {};
// Maps session name → ms-since-epoch spawn time. Drives spawn-order
// sort. Tests that don't care about ordering omit names from this map
// (they sort to the end via Infinity but with all infinities the sort
// is a no-op, so order matches `items` declaration).
let spawnedAtMap = new Map<string, number>();

vi.mock('../context/SidebarContext.js', () => ({
  useSidebar: () => sidebarValue,
}));

vi.mock('../context/SessionContext.js', () => ({
  useSessionData: () => sessionValue,
}));

vi.mock('../pty-registry.js', () => ({
  getSpawnedAt: (name: string) => spawnedAtMap.get(name),
}));

// Imported AFTER vi.mock — required so the mocks are wired in.
const { SessionTabBar } = await import('./SessionTabBar.js');

// ── Fixtures ─────────────────────────────────────────────────────

function makeSession(name: string, running = true): AgentSession {
  return { name, running };
}

function makeSessionItem(
  name: string,
  opts: { running?: boolean; pr?: PullRequestInfo } = {}
): SidebarItem {
  return {
    kind: 'session',
    session: makeSession(name, opts.running ?? true),
    pr: opts.pr,
    isMerged: false,
  };
}

function makePr(id: number): PullRequestInfo {
  return {
    id,
    title: `PR ${id}`,
    sourceBranch: `branch-${id}`,
    targetBranch: 'master',
    url: `https://example.com/pr/${id}`,
    createdByIdentifier: 'someone',
    createdByDisplayName: 'Someone',
  };
}

function setSidebar(items: SidebarItem[], selectedIndex = 0) {
  sidebarValue = {
    items,
    selectedIndex,
  };
  // By default, give each running session a monotonically increasing
  // spawn time matching its declared order — so the tab bar's spawn
  // order matches the items array order. Individual tests can override
  // by calling setSpawnOrder directly after.
  spawnedAtMap = new Map();
  let t = 1;
  for (const item of items) {
    if (item.kind === 'session' && item.session.running) {
      spawnedAtMap.set(item.session.name, t++);
    }
  }
}

function setSpawnOrder(order: string[]) {
  spawnedAtMap = new Map(order.map((name, i) => [name, i + 1]));
}

function setSessions(prMap: Map<string, PullRequestInfo>) {
  sessionValue = {
    sessionPrMap: prMap,
  };
}

beforeEach(() => {
  sidebarValue = {};
  sessionValue = {};
  spawnedAtMap = new Map();
});

// ── Tests ────────────────────────────────────────────────────────

describe('SessionTabBar', () => {
  it('reserves an empty row when there are no running sessions', () => {
    setSidebar([]);
    setSessions(new Map());

    const { lastFrame } = render(<SessionTabBar />);
    const text = stripAnsi(lastFrame() ?? '').trim();
    expect(text).toBe('');
  });

  it('skips non-session rows and stopped sessions', () => {
    setSidebar([
      makeSessionItem('alpha', { running: false }),
      {
        kind: 'orphan-pr',
        pr: makePr(99),
      },
      makeSessionItem('beta', { running: true }),
    ]);
    setSessions(new Map());

    const text = stripAnsi(render(<SessionTabBar />).lastFrame() ?? '');
    expect(text).toContain('1 beta');
    expect(text).not.toContain('alpha');
    expect(text).not.toContain('#99');
  });

  it('renders #<prId> when the session has a PR', () => {
    const pr123 = makePr(123);
    setSidebar([
      makeSessionItem('alpha', { running: true, pr: pr123 }),
      makeSessionItem('beta', { running: true }),
    ]);
    setSessions(new Map([['alpha', pr123]]));

    const text = stripAnsi(render(<SessionTabBar />).lastFrame() ?? '');
    expect(text).toContain('1 #123');
    expect(text).toContain('2 beta');
  });

  it('middle-truncates long branch names at a 16-char cap', () => {
    setSidebar([
      makeSessionItem('this-is-a-very-long-branch-name', { running: true }),
    ]);
    setSessions(new Map());

    const text = stripAnsi(render(<SessionTabBar />).lastFrame() ?? '');
    // 16-char cap, middle ellipsis: head=8 ('this-is-'), tail=7
    // ('ch-name'). Full label "1 this-is-…ch-name".
    expect(text).toContain('1 this-is-…ch-name');
    // Sanity: the dropped middle ('a-very-long-bran') is not present.
    expect(text).not.toContain('a-very-long');
  });

  it('renders short names whole when they fit under the cap', () => {
    setSidebar([
      makeSessionItem('short-name', { running: true }), // 10 chars
    ]);
    setSessions(new Map());
    const text = stripAnsi(render(<SessionTabBar />).lastFrame() ?? '');
    expect(text).toContain('1 short-name');
    expect(text).not.toContain('…');
  });

  it('uses 0 as the digit for the 10th tab', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeSessionItem(`s${i + 1}`, { running: true })
    );
    setSidebar(items);
    setSessions(new Map());

    const text = stripAnsi(render(<SessionTabBar />).lastFrame() ?? '');
    expect(text).toContain('9 s9');
    expect(text).toContain('0 s10');
  });

  it('caps at 10 tabs and shows +N overflow indicator', () => {
    const items = Array.from({ length: 13 }, (_, i) =>
      makeSessionItem(`s${i + 1}`, { running: true })
    );
    setSidebar(items);
    setSessions(new Map());

    const text = stripAnsi(render(<SessionTabBar />).lastFrame() ?? '');
    expect(text).toContain('0 s10');
    expect(text).toContain('+3');
    expect(text).not.toContain('s11');
    expect(text).not.toContain('s13');
  });

  it('orders tabs by spawn time, not items array order', () => {
    // Items declared in alphabetical order…
    setSidebar([
      makeSessionItem('alpha', { running: true }),
      makeSessionItem('beta', { running: true }),
      makeSessionItem('gamma', { running: true }),
    ]);
    setSessions(new Map());
    // …but the user spawned them in a different order: gamma first,
    // then alpha, then beta. Tabs should reflect spawn order.
    setSpawnOrder(['gamma', 'alpha', 'beta']);

    const text = stripAnsi(render(<SessionTabBar />).lastFrame() ?? '');
    expect(text).toContain('1 gamma');
    expect(text).toContain('2 alpha');
    expect(text).toContain('3 beta');
  });

  it('marks the currently-selected session tab with inverse styling', () => {
    const items = [
      makeSessionItem('alpha', { running: true }),
      makeSessionItem('beta', { running: true }),
      makeSessionItem('gamma', { running: true }),
    ];
    setSidebar(items, 1); // beta selected
    setSessions(new Map());

    const frame = render(<SessionTabBar />).lastFrame() ?? '';
    // ANSI: ESC[7m turns inverse on, ESC[27m turns it off. The selected
    // tab's segment should be wrapped in those, regardless of any color
    // codes in between (cyan, etc.).
    const ESC = String.fromCharCode(27);
    const inverseOn = `${ESC}[7m`;
    const inverseOff = `${ESC}[27m`;
    const segments = frame.split(inverseOn).slice(1);
    const inverseBeta = segments.some((seg) => {
      const end = seg.indexOf(inverseOff);
      return end !== -1 && seg.slice(0, end).includes('2 beta');
    });
    expect(inverseBeta).toBe(true);

    // Sanity: alpha and gamma are NOT wrapped in inverse.
    expect(stripAnsi(frame)).toContain('1 alpha');
    expect(stripAnsi(frame)).toContain('3 gamma');
  });
});
