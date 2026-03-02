# Shell safety and bare repo worktree support

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Two upstream contributions to Kirby — one for shell injection hardening, one for bare repo worktree support.

**Architecture:** PR 1 replaces `exec()` (shell string interpolation) with `execFile()` (argument arrays) across `tmux-manager`. PR 2 adds auto-detection of bare repo layouts and configurable worktree paths, plus discovery of all existing worktrees regardless of who created them.

**Tech Stack:** TypeScript, Node.js child_process, vitest, Nx, Ink/React

---

## Setup

### Task 0: Fork setup and branch creation

**Files:**
- None (git operations only)

**Step 1: Add fork remote**

```bash
# From /home/vic/Work/dalacare/Kirby
git remote add fork git@github.com:sandsower/Kirby.git
```

**Step 2: Create branch for PR 1**

```bash
git checkout -b fix/shell-injection-hardening master
```

**Step 3: Verify clean state**

Run: `git status`
Expected: clean working tree on `fix/shell-injection-hardening`

---

## PR 1: Shell injection hardening

### Task 1: Add execFile to exec.ts

**Files:**
- Modify: `libs/tmux-manager/src/lib/exec.ts`

**Step 1: Add execFile export**

```typescript
import { exec as execCb, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

export const exec = promisify(execCb);
export const execFile = promisify(execFileCb);
```

**Step 2: Verify build**

Run: `npx nx build tmux-manager`
Expected: BUILD SUCCESS

---

### Task 2: Migrate tmux.ts to execFile

**Files:**
- Modify: `libs/tmux-manager/src/lib/tmux.ts`
- Modify: `libs/tmux-manager/src/lib/tmux.spec.ts`

**Step 1: Update the mock in tmux.spec.ts**

The mock needs to expose both `exec` and `execFile`. Replace the mock block:

```typescript
vi.mock('./exec.js', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

import { exec, execFile } from './exec.js';

const mockExec = vi.mocked(exec);
const mockExecFile = vi.mocked(execFile);
```

Update the `resolve` helper — `execFile` returns `{ stdout, stderr }` same as `exec`:

```typescript
function resolve(stdout = '') {
  return { stdout, stderr: '' };
}
```

**Step 2: Update test assertions for functions that will use execFile**

All tmux functions switch to `execFile`. Update each test's assertion from `mockExec` to `mockExecFile` and from string commands to argument arrays:

`isAvailable`:
```typescript
describe('isAvailable', () => {
  it('should return true when tmux is installed', async () => {
    mockExecFile.mockResolvedValueOnce(resolve('tmux 3.4'));
    expect(await isAvailable()).toBe(true);
  });
  it('should return false when tmux is not installed', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('command not found'));
    expect(await isAvailable()).toBe(false);
  });
});
```

`listSessions`:
```typescript
describe('listSessions', () => {
  it('should parse tmux output into sessions', async () => {
    mockExecFile.mockResolvedValueOnce(
      resolve('work|2|1708900000|1\ntest|1|1708900100|0\n')
    );
    const sessions = await listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.name).toBe('work');
  });
  it('should return empty array when tmux fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('no server running'));
    expect(await listSessions()).toEqual([]);
  });
});
```

`hasSession`:
```typescript
describe('hasSession', () => {
  it('should return true when session exists', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await hasSession('my-session')).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux', ['has-session', '-t', 'my-session'], { encoding: 'utf8' }
    );
  });
  it("should return false when session doesn't exist", async () => {
    mockExecFile.mockRejectedValueOnce(new Error('session not found'));
    expect(await hasSession('nonexistent')).toBe(false);
  });
  it('should reject invalid session names', async () => {
    await expect(hasSession('foo; rm -rf /')).rejects.toThrow('Invalid tmux session name');
  });
});
```

`createSession` — this is the biggest change. Tests now assert `execFile('tmux', [...args])`. The command goes through `sh -c`:
```typescript
describe('createSession', () => {
  it('should create a detached session', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await createSession('my-session')).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux', ['new-session', '-d', '-s', 'my-session'], { encoding: 'utf8' }
    );
  });

  it('should pass dimensions when provided', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await createSession('my-session', 120, 40)).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux', ['new-session', '-d', '-s', 'my-session', '-x', '120', '-y', '40'],
      { encoding: 'utf8' }
    );
  });

  it('should return false on failure', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('duplicate session'));
    expect(await createSession('existing')).toBe(false);
  });

  it('should reject invalid session names', async () => {
    await expect(createSession('foo; rm -rf /')).rejects.toThrow('Invalid tmux session name');
  });
});

describe('createSession with command', () => {
  it('should pass command via sh -c', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession('my-session', 120, 40, 'claude --worktree main')
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-d', '-s', 'my-session', '-x', '120', '-y', '40',
       'sh', '-c', 'claude --worktree main'],
      { encoding: 'utf8' }
    );
  });

  it('should work with command but no dimensions', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession('my-session', undefined, undefined, 'bash')
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-d', '-s', 'my-session', 'sh', '-c', 'bash'],
      { encoding: 'utf8' }
    );
  });
});

describe('createSession with cwd', () => {
  it('should include -c flag when cwd is provided', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession('my-session', 120, 40, 'claude', '/home/user/worktree')
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-d', '-s', 'my-session', '-x', '120', '-y', '40',
       '-c', '/home/user/worktree', 'sh', '-c', 'claude'],
      { encoding: 'utf8' }
    );
  });

  it('should work with cwd but no command', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession('my-session', 120, 40, undefined, '/home/user/worktree')
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-d', '-s', 'my-session', '-x', '120', '-y', '40',
       '-c', '/home/user/worktree'],
      { encoding: 'utf8' }
    );
  });

  it('should handle paths with spaces', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession('my-session', 120, 40, 'claude', '/home/user/JBT Marel/worktree')
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-d', '-s', 'my-session', '-x', '120', '-y', '40',
       '-c', '/home/user/JBT Marel/worktree', 'sh', '-c', 'claude'],
      { encoding: 'utf8' }
    );
  });
});

describe('killSession', () => {
  it('should return true on success', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await killSession('my-session')).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux', ['kill-session', '-t', 'my-session'], { encoding: 'utf8' }
    );
  });
  it('should return false on failure', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('session not found'));
    expect(await killSession('nonexistent')).toBe(false);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx nx test tmux-manager --run`
Expected: FAIL — implementation still uses `exec`, tests now expect `execFile`

**Step 4: Update tmux.ts implementation**

Replace all `exec` calls with `execFile`:

```typescript
import { execFile } from './exec.js';

export async function isAvailable(): Promise<boolean> {
  try {
    await execFile('tmux', ['-V'], { encoding: 'utf8' });
    return true;
  } catch { return false; }
}

export async function listSessions(): Promise<TmuxSession[]> {
  try {
    const { stdout } = await execFile(
      'tmux',
      ['list-sessions', '-F', '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}'],
      { encoding: 'utf8' }
    );
    return parseSessions(stdout);
  } catch { return []; }
}

export async function hasSession(name: string): Promise<boolean> {
  const safeName = validateSessionName(name);
  try {
    await execFile('tmux', ['has-session', '-t', safeName], { encoding: 'utf8' });
    return true;
  } catch { return false; }
}

export async function createSession(
  name: string, cols?: number, rows?: number,
  command?: string, cwd?: string
): Promise<boolean> {
  const safeName = validateSessionName(name);
  const args = ['new-session', '-d', '-s', safeName];
  if (cols !== undefined) args.push('-x', String(cols));
  if (rows !== undefined) args.push('-y', String(rows));
  if (cwd !== undefined) args.push('-c', cwd);
  if (command !== undefined) args.push('sh', '-c', command);
  try {
    await execFile('tmux', args, { encoding: 'utf8' });
    return true;
  } catch { return false; }
}

export async function killSession(name: string): Promise<boolean> {
  const safeName = validateSessionName(name);
  try {
    await execFile('tmux', ['kill-session', '-t', safeName], { encoding: 'utf8' });
    return true;
  } catch { return false; }
}
```

Remove the `import { exec }` line — `tmux.ts` no longer uses it.

**Step 5: Run tests to verify they pass**

Run: `npx nx test tmux-manager --run`
Expected: PASS

**Step 6: Commit**

```bash
git add libs/tmux-manager/src/lib/exec.ts libs/tmux-manager/src/lib/tmux.ts libs/tmux-manager/src/lib/tmux.spec.ts
git commit -m "refactor: replace exec with execFile in tmux commands

Shell arguments are now passed as arrays instead of interpolated strings.
Commands that need shell semantics (aiCommand) go through sh -c."
```

---

### Task 3: Migrate worktree.ts to execFile

**Files:**
- Modify: `libs/tmux-manager/src/lib/worktree.ts`
- Modify: `libs/tmux-manager/src/lib/worktree.spec.ts`

**Step 1: Update mock and test assertions in worktree.spec.ts**

Add `execFile` to the mock:

```typescript
vi.mock('./exec.js', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

import { exec, execFile } from './exec.js';

const mockExec = vi.mocked(exec);
const mockExecFile = vi.mocked(execFile);
```

Update every test that currently asserts `mockExec` with a git command string. Each becomes `mockExecFile` with argument array. Examples:

`createWorktree`:
```typescript
it('should return absolute path for existing branch', async () => {
  mockExecFile.mockResolvedValueOnce(resolve());
  const result = await createWorktree('feature/auth');
  expect(result).toContain('.kirby/worktrees/feature-auth');
  expect(mockExecFile).toHaveBeenCalledWith(
    'git', ['worktree', 'add', '.kirby/worktrees/feature-auth', 'feature/auth'],
    { encoding: 'utf8' }
  );
});
```

`removeWorktree`:
```typescript
it('should return true on success', async () => {
  mockExecFile.mockResolvedValueOnce(resolve());
  expect(await removeWorktree('feature/auth')).toBe(true);
  expect(mockExecFile).toHaveBeenCalledWith(
    'git', ['worktree', 'remove', '.kirby/worktrees/feature-auth'],
    { encoding: 'utf8' }
  );
});
```

`canRemoveBranch` — status check uses `-C` as a separate arg:
```typescript
it('should reject branches with uncommitted changes', async () => {
  mockExecFile.mockResolvedValueOnce(resolve(' M src/file.ts\n'));
  expect(await canRemoveBranch('feature/dirty')).toEqual({
    safe: false, reason: 'uncommitted changes',
  });
});
```

`listBranches`, `fetchRemote`, `listAllBranches`, `fastForwardMaster`, `countConflicts`, `rebaseOntoMaster`, `deleteBranch`, `listWorktrees` — all follow the same pattern: `mockExec` → `mockExecFile`, string → array.

**Step 2: Run tests to verify they fail**

Run: `npx nx test tmux-manager --run`
Expected: FAIL

**Step 3: Update worktree.ts implementation**

Replace every `exec(...)` call with `execFile('git', [...])`. The import changes to:

```typescript
import { execFile } from './exec.js';
```

Full list of transformations:

| Function | Before | After |
|---|---|---|
| `createWorktree` | `exec(\`git worktree add "${dir}" "${branch}"\`)` | `execFile('git', ['worktree', 'add', dir, branch])` |
| `createWorktree` (new) | `exec(\`git worktree add -b "${branch}" "${dir}"\`)` | `execFile('git', ['worktree', 'add', '-b', branch, dir])` |
| `removeWorktree` | `exec(\`git worktree remove "${dir}"\`)` | `execFile('git', ['worktree', 'remove', dir])` |
| `canRemoveBranch` (status) | `exec(\`git -C "${dir}" status --porcelain\`)` | `execFile('git', ['-C', dir, 'status', '--porcelain'])` |
| `canRemoveBranch` (log) | `exec(\`git log "${branch}" --not --remotes -1\`)` | `execFile('git', ['log', branch, '--not', '--remotes', '-1'])` |
| `listBranches` | `exec("git branch --format='%(refname:short)'")`| `execFile('git', ['branch', '--format=%(refname:short)'])` |
| `fetchRemote` | `exec('git fetch --all --prune')` | `execFile('git', ['fetch', '--all', '--prune'])` |
| `listAllBranches` | `exec("git branch -a --format='%(refname:short)'")` | `execFile('git', ['branch', '-a', '--format=%(refname:short)'])` |
| `listWorktrees` | `exec('git worktree list --porcelain')` | `execFile('git', ['worktree', 'list', '--porcelain'])` |
| `fastForwardMaster` (fetch) | `exec('git fetch origin master')` | `execFile('git', ['fetch', 'origin', 'master'])` |
| `fastForwardMaster` (branch) | `exec('git branch -f master origin/master')` | `execFile('git', ['branch', '-f', 'master', 'origin/master'])` |
| `countConflicts` | `exec(\`git merge-tree --write-tree origin/master "${branch}"\`)` | `execFile('git', ['merge-tree', '--write-tree', 'origin/master', branch])` |
| `deleteBranch` | `exec(\`git branch -d "${branch}"\`)` | `execFile('git', ['branch', '-d', branch])` |
| `rebaseOntoMaster` (fetch) | `exec(\`git -C "${path}" fetch origin master\`)` | `execFile('git', ['-C', path, 'fetch', 'origin', 'master'])` |
| `rebaseOntoMaster` (rebase) | `exec(\`git -C "${path}" rebase origin/master\`)` | `execFile('git', ['-C', path, 'rebase', 'origin/master'])` |
| `rebaseOntoMaster` (abort) | `exec(\`git -C "${path}" rebase --abort\`)` | `execFile('git', ['-C', path, 'rebase', '--abort'])` |

Note: `listBranches` and `listAllBranches` currently wrap the format string in single quotes (shell quoting). With `execFile` there's no shell, so the quotes go away and the format string is passed directly.

**Step 4: Run tests to verify they pass**

Run: `npx nx test tmux-manager --run`
Expected: PASS

**Step 5: Run integration tests too**

Run: `npx nx test tmux-manager --run`
Expected: PASS (integration tests use real git commands via the actual `execFile`, not mocks)

**Step 6: Commit**

```bash
git add libs/tmux-manager/src/lib/worktree.ts libs/tmux-manager/src/lib/worktree.spec.ts
git commit -m "refactor: replace exec with execFile in git commands

All git operations now use argument arrays, preventing shell expansion
of branch names, paths, and other user-controlled strings."
```

---

### Task 4: Fix review prompt injection in input-handlers.ts

**Files:**
- Modify: `apps/cli/src/input-handlers.ts`

**Step 1: Update the review prompt construction**

In `startReviewSession`, replace:

```typescript
  const safePrompt = prompt.replace(/['"]/g, '');
  const command = `claude --continue || claude '${safePrompt}'`;
```

With:

```typescript
  const command = `claude --continue || claude ${JSON.stringify(prompt)}`;
```

`JSON.stringify` produces a double-quoted, properly escaped string. Since the whole command passes through `sh -c` (via the `createSession` change in Task 2), this is safe — the shell gets a properly quoted argument.

**Step 2: Build to verify no type errors**

Run: `npx nx build cli`
Expected: BUILD SUCCESS

**Step 3: Commit**

```bash
git add apps/cli/src/input-handlers.ts
git commit -m "fix: use JSON.stringify for review prompt instead of quote stripping

The previous approach stripped quotes but didn't handle \$() or backtick
expansion. With createSession now using execFile, the prompt goes through
sh -c as a properly escaped argument."
```

---

### Task 5: Push PR 1 branch

**Step 1: Push to fork**

```bash
git push -u fork fix/shell-injection-hardening
```

**Step 2: Create PR (do NOT run yet — just prepare)**

Target: `HermannBjorgvin/Kirby:master`
Title: `fix: replace shell string interpolation with execFile in tmux-manager`

This step should wait until all tasks for PR 1 are confirmed working.

---

## PR 2: Bare repo worktree support

### Task 6: Create branch for PR 2

**Step 1: Branch from master**

```bash
git checkout -b feat/bare-repo-worktree-support master
```

---

### Task 7: Add WorktreeResolver and createResolver

**Files:**
- Create: `libs/tmux-manager/src/lib/worktree-resolver.ts`
- Create: `libs/tmux-manager/src/lib/worktree-resolver.spec.ts`
- Modify: `libs/tmux-manager/src/index.ts`

**Step 1: Write failing tests for createResolver**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResolver, sanitizeBranch } from './worktree-resolver.js';

vi.mock('./exec.js', () => ({
  execFile: vi.fn(),
}));

import { execFile } from './exec.js';

const mockExecFile = vi.mocked(execFile);

function resolve(stdout = '') {
  return { stdout, stderr: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sanitizeBranch', () => {
  it('should replace slashes with hyphens', () => {
    expect(sanitizeBranch('feature/auth')).toBe('feature-auth');
  });
  it('should handle multiple slashes', () => {
    expect(sanitizeBranch('feat/ui/sidebar')).toBe('feat-ui-sidebar');
  });
  it('should leave clean names alone', () => {
    expect(sanitizeBranch('main')).toBe('main');
  });
});

describe('createResolver', () => {
  it('should use config override when provided', async () => {
    const resolver = await createResolver('/custom/path/{branch}');
    expect(resolver.pathFor('feature/auth')).toBe('/custom/path/feature-auth');
  });

  it('should use relative config override resolved against cwd', async () => {
    const resolver = await createResolver('../{branch}');
    const expected = require('node:path').resolve(process.cwd(), '../feature-auth');
    expect(resolver.pathFor('feature/auth')).toBe(expected);
  });

  it('should detect bare repo and use sibling layout', async () => {
    // git rev-parse --is-bare-repository
    mockExecFile.mockResolvedValueOnce(resolve('true'));
    // git rev-parse --git-common-dir
    mockExecFile.mockResolvedValueOnce(resolve('/home/user/repo.git'));

    const resolver = await createResolver();
    expect(resolver.pathFor('feature/auth')).toBe('/home/user/repo.git/feature-auth');
  });

  it('should fall back to .kirby/worktrees/ for non-bare repos', async () => {
    mockExecFile.mockResolvedValueOnce(resolve('false'));

    const resolver = await createResolver();
    expect(resolver.pathFor('feature/auth')).toContain('.kirby/worktrees/feature-auth');
  });

  it('owns() should match paths within the worktree scope', async () => {
    mockExecFile.mockResolvedValueOnce(resolve('true'));
    mockExecFile.mockResolvedValueOnce(resolve('/home/user/repo.git'));

    const resolver = await createResolver();
    expect(resolver.owns('/home/user/repo.git/feature-auth')).toBe(true);
    expect(resolver.owns('/somewhere/else/feature-auth')).toBe(false);
  });
});
```

**Step 2: Run to verify they fail**

Run: `npx nx test tmux-manager --run`
Expected: FAIL — module doesn't exist yet

**Step 3: Implement worktree-resolver.ts**

```typescript
import { resolve as pathResolve } from 'node:path';
import { execFile } from './exec.js';

export function sanitizeBranch(branch: string): string {
  return branch.replace(/\//g, '-');
}

export interface WorktreeResolver {
  pathFor(branch: string): string;
  owns(worktreePath: string): boolean;
}

export async function createResolver(
  configOverride?: string
): Promise<WorktreeResolver> {
  // 1. Config override
  if (configOverride) {
    return templateResolver(configOverride);
  }

  // 2. Bare repo detection
  try {
    const { stdout: isBare } = await execFile(
      'git', ['rev-parse', '--is-bare-repository'], { encoding: 'utf8' }
    );
    if (isBare.trim() === 'true') {
      const { stdout: gitDir } = await execFile(
        'git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }
      );
      const bareRoot = pathResolve(gitDir.trim());
      return {
        pathFor: (branch) => pathResolve(bareRoot, sanitizeBranch(branch)),
        owns: (p) => p.startsWith(bareRoot) && p !== bareRoot,
      };
    }
  } catch {
    // Not a git repo or git not available — fall through to default
  }

  // 3. Default: .kirby/worktrees/
  const base = pathResolve(process.cwd(), '.kirby/worktrees');
  return {
    pathFor: (branch) => pathResolve(base, sanitizeBranch(branch)),
    owns: (p) => p.includes('.kirby/worktrees/'),
  };
}

function templateResolver(template: string): WorktreeResolver {
  const isAbsolute = template.startsWith('/');
  const base = isAbsolute ? '' : process.cwd();
  return {
    pathFor: (branch) => {
      const expanded = template.replace('{branch}', sanitizeBranch(branch));
      return isAbsolute ? expanded : pathResolve(base, expanded);
    },
    owns: () => true, // config override means "I own everything"
  };
}
```

**Step 4: Export from index.ts**

Add to `libs/tmux-manager/src/index.ts`:

```typescript
export * from './lib/worktree-resolver.js';
```

**Step 5: Run tests**

Run: `npx nx test tmux-manager --run`
Expected: PASS

**Step 6: Commit**

```bash
git add libs/tmux-manager/src/lib/worktree-resolver.ts libs/tmux-manager/src/lib/worktree-resolver.spec.ts libs/tmux-manager/src/index.ts
git commit -m "feat: add WorktreeResolver with bare repo auto-detection

Detects bare repo layouts and places worktrees as siblings of the
bare directory. Falls back to .kirby/worktrees/ for normal repos.
Supports a config override template for custom layouts."
```

---

### Task 8: Update worktree.ts to accept resolver

**Files:**
- Modify: `libs/tmux-manager/src/lib/worktree.ts`
- Modify: `libs/tmux-manager/src/lib/worktree.spec.ts`

**Step 1: Update function signatures**

Add `resolver: WorktreeResolver` as an optional last parameter to `createWorktree`, `removeWorktree`, `canRemoveBranch`. When not provided, fall back to the old `.kirby/worktrees/` behavior for backward compatibility.

```typescript
import type { WorktreeResolver } from './worktree-resolver.js';
import { sanitizeBranch } from './worktree-resolver.js';

// Keep old function for backward compat (tests, etc.)
function defaultDir(branch: string): string {
  return '.kirby/worktrees/' + sanitizeBranch(branch);
}

export async function createWorktree(
  branch: string,
  resolver?: WorktreeResolver
): Promise<string | null> {
  const absoluteDir = resolver
    ? resolver.pathFor(branch)
    : resolve(process.cwd(), defaultDir(branch));
  const relativeDir = resolver
    ? absoluteDir  // resolver gives absolute paths, use directly
    : defaultDir(branch);
  // ... rest is same but uses relativeDir/absoluteDir
}
```

Same pattern for `removeWorktree` and `canRemoveBranch`.

**Step 2: Update listWorktrees to accept a resolver and drop path filter**

```typescript
export async function listWorktrees(
  resolver?: WorktreeResolver
): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await execFile(
      'git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' }
    );
    const all = parseWorktrees(stdout);
    // Exclude bare entries and the first worktree (main checkout)
    const nonBare = all.filter((w) => !w.bare);
    if (nonBare.length === 0) return [];
    // First entry from git worktree list is always the main worktree
    const mainPath = nonBare[0]!.path;
    return nonBare.filter((w) => {
      if (w.path === mainPath) return false;
      if (resolver) return resolver.owns(w.path);
      return w.path.includes('.kirby/worktrees/');
    });
  } catch { return []; }
}
```

**Step 3: Update relevant tests**

The existing tests should still pass unchanged (resolver is optional). Add new tests that pass a resolver:

```typescript
describe('listWorktrees with resolver', () => {
  it('should use resolver.owns() to filter worktrees', async () => {
    mockExecFile.mockResolvedValueOnce(
      resolve([
        'worktree /home/user/repo.git',
        'HEAD abc123',
        'bare',
        '',
        'worktree /home/user/repo.git/main',
        'HEAD def456',
        'branch refs/heads/main',
        '',
        'worktree /home/user/repo.git/feature-auth',
        'HEAD 789abc',
        'branch refs/heads/feature/auth',
        '',
      ].join('\n'))
    );

    const resolver = {
      pathFor: (b: string) => `/home/user/repo.git/${b.replace(/\//g, '-')}`,
      owns: (p: string) => p.startsWith('/home/user/repo.git/') && p !== '/home/user/repo.git/',
    };

    const result = await listWorktrees(resolver);
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe('feature/auth');
  });
});
```

**Step 4: Run tests**

Run: `npx nx test tmux-manager --run`
Expected: PASS (existing tests work with optional param, new tests pass)

**Step 5: Commit**

```bash
git add libs/tmux-manager/src/lib/worktree.ts libs/tmux-manager/src/lib/worktree.spec.ts
git commit -m "feat: thread WorktreeResolver through worktree operations

createWorktree, removeWorktree, canRemoveBranch, and listWorktrees
accept an optional resolver. Without it, behavior is unchanged.
listWorktrees now uses the resolver's owns() to decide which worktrees
to show instead of hardcoded .kirby/worktrees/ filtering."
```

---

### Task 9: Add worktreePath to config

**Files:**
- Modify: `libs/vcs/core/src/lib/types.ts`
- Modify: `libs/vcs/core/src/lib/config-store.ts`
- Modify: `libs/vcs/core/src/lib/config-store.spec.ts`

**Step 1: Add worktreePath to AppConfig**

In `types.ts`, add to the `AppConfig` interface:

```typescript
worktreePath?: string;
```

**Step 2: Add worktreePath to readConfig**

In `config-store.ts`, in the `readConfig` function, add:

```typescript
worktreePath: global.worktreePath,
```

And add to `RawGlobalConfig`:

```typescript
worktreePath?: string;
```

**Step 3: Add a test for worktreePath roundtrip**

In `config-store.spec.ts`:

```typescript
it('should read worktreePath from global config', () => {
  mockReadFileSync.mockReturnValueOnce(
    JSON.stringify({ worktreePath: '../{branch}' })
  );
  mockReadFileSync.mockReturnValueOnce(JSON.stringify({}));

  const config = readConfig('/tmp/test');
  expect(config.worktreePath).toBe('../{branch}');
});
```

**Step 4: Run tests**

Run: `npx nx test vcs-core --run`
Expected: PASS

**Step 5: Commit**

```bash
git add libs/vcs/core/src/lib/types.ts libs/vcs/core/src/lib/config-store.ts libs/vcs/core/src/lib/config-store.spec.ts
git commit -m "feat: add worktreePath config option

Stored in global config. When set, overrides auto-detection of
worktree placement strategy."
```

---

### Task 10: Add worktree path to settings panel

**Files:**
- Modify: `apps/cli/src/components/SettingsPanel.tsx`

**Step 1: Add field to buildSettingsFields**

Add after the "AI Tool" field (before "Email"):

```typescript
{
  label: 'Worktree Path',
  key: 'worktreePath',
  description: 'Template for worktree placement. {branch} is replaced with the sanitized branch name. Auto-detected from repo layout if not set.',
  configBag: 'global',
},
```

**Step 2: Build to verify**

Run: `npx nx build cli`
Expected: BUILD SUCCESS

**Step 3: Commit**

```bash
git add apps/cli/src/components/SettingsPanel.tsx
git commit -m "feat: add worktree path to settings panel"
```

---

### Task 11: Thread resolver through the app

**Files:**
- Modify: `apps/cli/src/hooks/useSessionManager.ts`
- Modify: `apps/cli/src/input-handlers.ts`

**Step 1: Create resolver in useSessionManager**

Import `createResolver` and create it on mount. Store in a ref so it's available to all operations:

```typescript
import { createResolver } from '@kirby/tmux-manager';
import type { WorktreeResolver } from '@kirby/tmux-manager';

// Inside useSessionManager:
const resolverRef = useRef<WorktreeResolver | null>(null);

// In the useEffect init block, after isAvailable check:
const resolver = await createResolver(readConfig().worktreePath);
resolverRef.current = resolver;
```

Pass the resolver to `listWorktrees`, `createWorktree`, etc. in `refreshSessions` and `performDelete`.

**Step 2: Add resolver to AppContext**

In `input-handlers.ts`, add `resolver: WorktreeResolver | null` to `AppContext`. Thread it through `createWorktree` calls in `handleBranchPickerInput`, `handleSidebarInput`, `handleGlobalInput`, and `startReviewSession`.

**Step 3: Build to verify**

Run: `npx nx build cli`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add apps/cli/src/hooks/useSessionManager.ts apps/cli/src/input-handlers.ts
git commit -m "feat: thread WorktreeResolver through the app

The resolver is created once on startup from config + repo detection.
All worktree operations use it for path resolution and discovery."
```

---

### Task 12: Push PR 2 branch

**Step 1: Push to fork**

```bash
git push -u fork feat/bare-repo-worktree-support
```

---

## Verification

After both branches are pushed, verify:

1. `git log --oneline fix/shell-injection-hardening..master` shows no divergence
2. `git log --oneline feat/bare-repo-worktree-support..master` shows no divergence
3. Both branches have clean `npx nx test tmux-manager --run` and `npx nx test vcs-core --run`
4. `npx nx build cli` passes on both branches
