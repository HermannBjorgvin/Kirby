import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A repository with a pull-request-sized change in it — the input the
 * diff viewer is actually slow on.
 *
 * The desktop fetches diffs with `-U99999`, so a "60 changed lines"
 * pull request still ships every line of every touched file to the
 * renderer. A benchmark seeded with the e2e suite's one-file repo would
 * therefore measure nothing: the interesting costs (parse, shiki
 * tokenization, word diff, row virtualization) all scale with the
 * *whole file*, not with the hunk. So files here are realistically
 * long, and only a fraction of their lines differ.
 */

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export interface BigRepoOptions {
  /** Files the pull request touches. */
  files?: number;
  /** Lines per file. */
  linesPerFile?: number;
  /** Fraction of each file's lines the branch rewrites. */
  changedFraction?: number;
  branch?: string;
}

/** Deterministic pseudo-source, so every run diffs the same bytes. */
function sourceFile(seed: number, lines: number): string {
  const out: string[] = [
    `import { helper${seed} } from './helper-${seed}.js';`,
    '',
    `export interface Shape${seed} {`,
    '  id: string;',
    '  value: number;',
    '}',
    '',
  ];
  for (let i = out.length; i < lines; i++) {
    const k = (seed * 7919 + i * 104729) % 6;
    if (k === 0) out.push(`export function fn_${seed}_${i}(input: string) {`);
    else if (k === 1) out.push(`  const total = input.length * ${i};`);
    else if (k === 2)
      out.push(`  if (total > ${i * 3}) return helper${seed}(total);`);
    else if (k === 3)
      out.push(`  // step ${i}: fold the accumulator into the result`);
    else if (k === 4)
      out.push(`  return { id: '${seed}-${i}', value: total };`);
    else out.push('}');
  }
  return out.join('\n') + '\n';
}

/** The same file with one line in every `1/fraction` rewritten. */
function editedFile(seed: number, lines: number, fraction: number): string {
  const step = Math.max(2, Math.round(1 / fraction));
  return sourceFile(seed, lines)
    .split('\n')
    .map((l, i) =>
      i > 6 && i % step === 0 ? `  const patched_${i} = ${i};` : l
    )
    .join('\n');
}

export interface BigRepo {
  path: string;
  branch: string;
  cleanup(): void;
}

export function createBigRepo(opts: BigRepoOptions = {}): BigRepo {
  const files = opts.files ?? 24;
  const lines = opts.linesPerFile ?? 400;
  const fraction = opts.changedFraction ?? 0.12;
  const branch = opts.branch ?? 'perf-big-change';

  const parent = mkdtempSync(join(tmpdir(), 'kirby-perf-repo-'));
  const dir = join(parent, 'kirby-perf');
  mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'perf@kirby.dev']);
  git(dir, ['config', 'user.name', 'Kirby Perf']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'README.md'), '# perf repo\n', 'utf8');
  for (let f = 0; f < files; f++) {
    writeFileSync(
      join(dir, 'src', `module-${f}.ts`),
      sourceFile(f, lines),
      'utf8'
    );
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'baseline']);

  // The change lands as a worktree on `branch`, where the app expects
  // a session's checkout to be.
  const wt = join(dir, '.claude', 'worktrees', branch);
  git(dir, ['worktree', 'add', '-q', wt, '-b', branch]);
  for (let f = 0; f < files; f++) {
    writeFileSync(
      join(wt, 'src', `module-${f}.ts`),
      editedFile(f, lines, fraction),
      'utf8'
    );
  }
  git(wt, ['add', '-A']);
  git(wt, ['commit', '-q', '-m', 'the change under review']);

  return {
    path: dir,
    branch,
    cleanup: () => {
      try {
        rmSync(parent, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
