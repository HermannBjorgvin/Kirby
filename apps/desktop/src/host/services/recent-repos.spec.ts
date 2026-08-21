import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  forgetRecent,
  loadRecents,
  recordOpen,
  saveRecents,
  type RecentRepo,
} from './recent-repos.js';

let file: string;

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'kirby-recents-')), 'recents.json');
});

describe('loadRecents', () => {
  it('returns an empty list when no file exists', () => {
    expect(loadRecents(file)).toEqual([]);
  });

  it('round-trips saved entries', () => {
    const recents: RecentRepo[] = [
      { cwd: '/a/b', lastOpenedAt: 100 },
      { cwd: '/c/d', lastOpenedAt: 200 },
    ];
    saveRecents(recents, file);
    expect(loadRecents(file)).toEqual(recents);
  });

  it('survives corrupt json by returning empty list', () => {
    writeFileSync(file, '{not json');
    expect(loadRecents(file)).toEqual([]);
  });
});

describe('recordOpen', () => {
  it('adds a new repo at the front with a timestamp', () => {
    const t0 = Date.now();
    const next = recordOpen([], '/repos/alpha');
    expect(next).toHaveLength(1);
    expect(next[0]!.cwd).toBe('/repos/alpha');
    expect(next[0]!.lastOpenedAt).toBeGreaterThanOrEqual(t0);
  });

  it('moves an existing repo to the front instead of duplicating', () => {
    let recents: RecentRepo[] = [
      { cwd: '/old', lastOpenedAt: 1 },
      { cwd: '/newer', lastOpenedAt: 2 },
    ];
    recents = recordOpen(recents, '/old');
    expect(recents.map((r) => r.cwd)).toEqual(['/old', '/newer']);
  });

  it('caps the list at ten entries', () => {
    let recents: RecentRepo[] = [];
    for (let i = 0; i < 15; i++) {
      recents = recordOpen(recents, `/repo-${i}`);
    }
    expect(recents).toHaveLength(10);
    expect(recents[0]!.cwd).toBe('/repo-14');
    expect(recents.at(-1)!.cwd).toBe('/repo-5');
  });
});

describe('forgetRecent', () => {
  it('removes the entry and persists the change', () => {
    saveRecents(
      [
        { cwd: '/a', lastOpenedAt: 1 },
        { cwd: '/b', lastOpenedAt: 2 },
      ],
      file
    );
    forgetRecent('/a', file);
    expect(loadRecents(file).map((r) => r.cwd)).toEqual(['/b']);
  });

  it('removes the state file entirely when the last entry goes', () => {
    saveRecents([{ cwd: '/a', lastOpenedAt: 1 }], file);
    forgetRecent('/a', file);
    expect(existsSync(file)).toBe(false);
    expect(loadRecents(file)).toEqual([]);
  });
});

describe('saveRecents round trip via loadRecents', () => {
  it('writes valid json to disk', () => {
    saveRecents([{ cwd: '/x', lastOpenedAt: 5 }], file);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw[0].cwd).toBe('/x');
  });
});
