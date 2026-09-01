import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '@kirby/diff';
import {
  BINARY_NOTE,
  DEFAULT_WORKTREE_DIFF_LIMITS,
  fetchWorktreeDiffText,
} from './worktree-diff.js';

/**
 * The worktree diff against real git.
 *
 * The failure this exists for is not subtle and not hypothetical: with
 * whole-file context, one generated file in a worktree makes a patch
 * larger than `execFile`'s buffer, and the call then rejects with
 * "stdout maxBuffer length exceeded" — no diff at all, for any file, for
 * as long as that file is there. Each case below is built from a real
 * repository because the interesting behaviour is git's: what `--numstat`
 * calls binary, what `--exclude-standard` leaves out, what an exclude
 * pathspec removes.
 */

const MB = 1024 * 1024;

/** A text file of roughly `bytes`, one hundred characters per line. */
function textOf(bytes: number): string {
  return `${'x'.repeat(99)}\n`.repeat(Math.ceil(bytes / 100));
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

let repo: string;
let worktree: string;
const originalCwd = process.cwd();

/** Write a file inside the worktree and commit it on its branch. */
function commitInWorktree(files: Record<string, string | Buffer>): void {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(worktree, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
    git(worktree, ['add', '--', name]);
  }
  git(worktree, ['commit', '-q', '-m', 'work']);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'kirby-worktree-diff-'));
  git(repo, ['init', '-q', '-b', 'main', '.']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'README.md'), 'a repo\n');
  writeFileSync(join(repo, '.gitignore'), 'ignored/\n*.log\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'initial']);

  worktree = join(repo, 'wt');
  git(repo, ['worktree', 'add', '-q', worktree, '-b', 'feature']);

  // resolveRef asks git about the target branch in the process's own
  // directory, which is how the app runs it (the host chdirs into the
  // repo it opened).
  process.chdir(repo);
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
});

describe('fetchWorktreeDiffText', () => {
  it('renders committed and uncommitted work together', async () => {
    commitInWorktree({ 'src/app.ts': 'const app = 1;\n' });
    writeFileSync(join(worktree, 'scratch.txt'), 'not committed\n');

    const files = parseUnifiedDiff(
      await fetchWorktreeDiffText(worktree, 'main')
    );
    expect([...files.keys()].sort()).toEqual(['scratch.txt', 'src/app.ts']);
  });

  it('summarises a file too large to diff and still renders the rest', async () => {
    commitInWorktree({
      'generated.json': textOf(3 * MB),
      'small.ts': 'const small = 1;\n',
    });

    const files = parseUnifiedDiff(
      await fetchWorktreeDiffText(worktree, 'main')
    );
    const note = files.get('generated.json')?.find((l) => l.type === 'add');
    expect(note?.content).toMatch(/^file too large to diff, 3\.0 MB$/);
    // The whole point of the placeholder: the rest of the diff survives.
    expect(files.get('small.ts')?.map((l) => l.content)).toContain(
      'const small = 1;'
    );
  });

  it('survives a file whose whole-file diff dwarfs any buffer', async () => {
    // 56 MB — past what `execFile` was given, which is what turned one
    // generated file into "stdout maxBuffer length exceeded" for the
    // entire tab.
    commitInWorktree({ 'huge.txt': textOf(56 * MB) });

    const files = parseUnifiedDiff(
      await fetchWorktreeDiffText(worktree, 'main')
    );
    expect(files.get('huge.txt')?.at(-1)?.content).toMatch(
      /^file too large to diff, 5[0-9]\.\d MB$/
    );
    expect(files.has('small.ts')).toBe(true);
  }, 60_000);

  it('summarises a binary file rather than diffing or dropping it', async () => {
    commitInWorktree({
      'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]),
    });
    writeFileSync(
      join(worktree, 'untracked.bin'),
      Buffer.from([0x00, 0x01, 0x00, 0x02])
    );

    const files = parseUnifiedDiff(
      await fetchWorktreeDiffText(worktree, 'main')
    );
    expect(files.get('logo.png')?.at(-1)?.content).toBe(BINARY_NOTE);
    expect(files.get('untracked.bin')?.at(-1)?.content).toBe(BINARY_NOTE);
    rmSync(join(worktree, 'untracked.bin'));
  });

  it('never includes a file git ignores', async () => {
    mkdirSync(join(worktree, 'ignored'), { recursive: true });
    writeFileSync(join(worktree, 'ignored', 'huge.json'), textOf(4 * MB));
    writeFileSync(join(worktree, 'debug.log'), 'noise\n');

    const files = parseUnifiedDiff(
      await fetchWorktreeDiffText(worktree, 'main')
    );
    expect([...files.keys()].filter((f) => f.includes('ignored'))).toEqual([]);
    expect(files.has('debug.log')).toBe(false);
  });

  it('summarises an oversized untracked file without reading it whole', async () => {
    writeFileSync(join(worktree, 'dump.sql'), textOf(3 * MB));

    const files = parseUnifiedDiff(
      await fetchWorktreeDiffText(worktree, 'main')
    );
    expect(files.get('dump.sql')?.at(-1)?.content).toMatch(
      /^file too large to diff, 3\.0 MB$/
    );
    rmSync(join(worktree, 'dump.sql'));
  });

  it('truncates at a file boundary rather than failing when the patch overruns', async () => {
    // Its own worktree, with two files of known size, so the ceiling can
    // be set to land between them: the first must arrive whole, the
    // second must not arrive half-parsed, and nothing may reject.
    const second = join(repo, 'wt2');
    git(repo, ['worktree', 'add', '-q', second, '-b', 'overrun']);
    for (const name of ['a.txt', 'b.txt']) {
      writeFileSync(join(second, name), textOf(2000));
      git(second, ['add', '--', name]);
    }
    git(second, ['commit', '-q', '-m', 'two files']);

    const whole = await fetchWorktreeDiffText(second, 'main');
    const text = await fetchWorktreeDiffText(second, 'main', {
      ...DEFAULT_WORKTREE_DIFF_LIMITS,
      maxTotalBytes: Math.floor(whole.length * 0.75),
    });
    const files = parseUnifiedDiff(text);

    expect(files.get('kirby/diff-truncated')?.at(-1)?.content).toMatch(
      /exceeded 0\.0 MB and was cut short/
    );
    // The file that fitted is whole — every one of its lines is there,
    // not a prefix ending mid-hunk.
    expect(files.get('a.txt')?.filter((l) => l.type === 'add')).toHaveLength(20);
    expect(files.has('b.txt')).toBe(false);
  });
});
