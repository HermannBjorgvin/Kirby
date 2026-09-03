import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { displayPath, resolvePickedFolder, terminalRepo } from './terminal-home.js';

/**
 * Where a terminal belongs. A directory that is itself a repository
 * root joins that repository's tab group; any other directory —
 * including one *inside* a repository — is a plain folder and belongs
 * to nobody.
 */
describe('terminalRepo', () => {
  const roots = new Set(['/home/dev/kirby', '/home/dev/other']);
  const isRoot = (p: string) => roots.has(p);

  it('binds a repository root to itself', () => {
    expect(terminalRepo('/home/dev/kirby', isRoot)).toBe('/home/dev/kirby');
  });

  it('treats a folder that is no repository as plain', () => {
    expect(terminalRepo('/home/dev/notes', isRoot)).toBeNull();
  });

  // The rule is "this directory", not "the nearest repository above
  // it": a terminal in a subfolder of a checkout is a plain folder, and
  // nothing walks up to find the checkout.
  it('never walks up from a subfolder of a repository', () => {
    const asked: string[] = [];
    const spy = (p: string) => {
      asked.push(p);
      return isRoot(p);
    };
    expect(terminalRepo('/home/dev/kirby/apps/desktop', spy)).toBeNull();
    expect(asked).toEqual(['/home/dev/kirby/apps/desktop']);
  });

  // A picker can hand back a trailing separator; the workspace names
  // the same repository without one, and the two must compare equal or
  // the terminal lands in a group of its own beside the repo's.
  it('drops a trailing separator so the root matches the open repo', () => {
    expect(terminalRepo('/home/dev/kirby/', isRoot)).toBe('/home/dev/kirby');
  });

  it('leaves the filesystem root alone', () => {
    expect(terminalRepo('/', () => true)).toBe('/');
  });
});

describe('displayPath', () => {
  it('writes the home directory as ~', () => {
    expect(displayPath('/home/dev/code/kirby', '/home/dev')).toBe(
      '~/code/kirby'
    );
    expect(displayPath('/home/dev', '/home/dev')).toBe('~');
  });

  // `/home/developer` starts with `/home/dev` and is not inside it.
  it('only substitutes at a path boundary', () => {
    expect(displayPath('/home/developer/x', '/home/dev')).toBe(
      '/home/developer/x'
    );
  });

  it('is the path itself when home is unknown', () => {
    expect(displayPath('/srv/app', '')).toBe('/srv/app');
  });
});

/**
 * `terminalRepo` compares a picked path against the open repository's
 * root as plain strings, and `getRepoRoot()` resolves symlinks via
 * `git rev-parse` — so a folder reached through a symlink into an
 * already-open repository must be canonicalized before it gets there,
 * or it reads as a second repository.
 */
describe('resolvePickedFolder', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('resolves a symlink to the real directory it points at', () => {
    dir = mkdtempSync(join(tmpdir(), 'kirby-picked-folder-'));
    const real = realpathSync(join(dir, '.'));
    const link = join(dir, 'link');
    symlinkSync(real, link);

    expect(resolvePickedFolder(link, realpathSync)).toBe(real);
    // The scenario this guards: the symlink and its target must read
    // as the same repository once resolved.
    expect(resolvePickedFolder(link, realpathSync)).toBe(
      resolvePickedFolder(real, realpathSync)
    );
  });

  it('falls back to the raw path when resolution fails', () => {
    const missing = '/definitely/not/a/real/path/kirby-test';
    expect(
      resolvePickedFolder(missing, () => {
        throw new Error('ENOENT');
      })
    ).toBe(missing);
  });
});
