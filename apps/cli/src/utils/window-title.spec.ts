import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  repoTitle,
  setWindowTitle,
  restoreWindowTitle,
} from './window-title.js';

describe('repoTitle', () => {
  let tmp: string;
  let repo: string;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'ignore' });

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kirby-window-title-'));
    repo = join(tmp, 'my-repo');
    mkdirSync(repo);

    git(repo, 'init', '-b', 'master');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'commit', '--allow-empty', '-m', 'init');
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('names the repo root directory', () => {
    expect(repoTitle(repo)).toBe('my-repo');
  });

  it('names the parent repo when run from inside a worktree', () => {
    const wt = join(repo, '.claude/worktrees/feature-x');
    git(repo, 'worktree', 'add', '-b', 'feature/x', wt);

    expect(repoTitle(wt)).toBe('my-repo');
  });

  it('falls back to the directory name outside a git repo', () => {
    const plain = join(tmp, 'not-a-repo');
    mkdirSync(plain);

    expect(repoTitle(plain)).toBe('not-a-repo');
  });
});

describe('setWindowTitle', () => {
  const PUSH = '\x1b[22;2t';
  const POP = '\x1b[23;2t';
  const osc = (title: string) => `\x1b]2;${title}\x07`;

  const originalIsTty = Object.getOwnPropertyDescriptor(
    process.stdout,
    'isTTY'
  );
  const asTty = (isTTY: boolean) =>
    Object.defineProperty(process.stdout, 'isTTY', {
      value: isTTY,
      configurable: true,
    });

  let writes: string[];

  beforeEach(() => {
    writes = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    asTty(true);
  });

  afterEach(() => {
    // The title stack is module-level state. Popping returns it to
    // "nothing pushed" so each test starts from the same place.
    restoreWindowTitle();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (originalIsTty) {
      Object.defineProperty(process.stdout, 'isTTY', originalIsTty);
    }
  });

  it('pushes the old title once, sets ours, and pops it back', () => {
    setWindowTitle('my-repo');
    setWindowTitle('other-repo');
    restoreWindowTitle();

    expect(writes).toEqual([PUSH, osc('my-repo'), osc('other-repo'), POP]);
  });

  it('strips control characters that would end the OSC string early', () => {
    setWindowTitle('my\x07-\x1brepo');

    expect(writes).toContain(osc('my-repo'));
  });

  it('writes nothing when stdout is not a TTY', () => {
    asTty(false);

    setWindowTitle('my-repo');
    restoreWindowTitle();

    expect(writes).toEqual([]);
  });

  it('does not pop a title it never pushed', () => {
    restoreWindowTitle();

    expect(writes).toEqual([]);
  });
});
