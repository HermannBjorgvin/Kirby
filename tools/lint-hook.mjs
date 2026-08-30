#!/usr/bin/env node
/**
 * PostToolUse hook: refuse a write that leaves a file with a lint problem.
 *
 * The workspace sits at zero errors and zero warnings, which is only
 * worth something if it stays there. A warning that arrives with an edit
 * is cheap to fix in the same breath and expensive to find a hundred
 * edits later, so this reports it while the change is still in hand.
 *
 * Reads Claude Code's hook payload on stdin and exits 2 to block, with
 * ESLint's own output on stderr.
 *
 * Why it does not simply run `eslint <file>` from the repo root: ESLint 9
 * loads flat config from the working directory, and three projects here
 * carry their own — `apps/cli-e2e`, `apps/desktop-e2e` and
 * `apps/cli-wterm-host` register the Playwright plugin that the root
 * config knows nothing about. Linting an e2e file from the root reports
 * "No issues found" on a file that genuinely violates its own rules. So
 * the config that owns a file decides where it is linted from.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Extensions ESLint is configured for: .js .jsx .ts .tsx .mjs .cjs .mts .cts */
const LINTABLE = /\.[mc]?[jt]sx?$/;

const repoRoot =
  process.env.CLAUDE_PROJECT_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Nothing to say — let the edit through. */
function pass() {
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The directory whose ESLint config governs `file`: the nearest ancestor
 * holding one, searched no higher than the repo. A file outside the repo
 * (a scratchpad note, another checkout) has none, and is not ours to lint.
 */
function configDirFor(file) {
  const root = resolve(repoRoot);
  let dir = dirname(resolve(file));
  if (relative(root, dir).startsWith('..')) return null;
  for (;;) {
    if (existsSync(join(dir, 'eslint.config.mjs'))) return dir;
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const raw = await readStdin();
let file;
try {
  file = JSON.parse(raw)?.tool_input?.file_path;
} catch {
  pass(); // Not a payload we understand; never block on our own confusion.
}

// A file that was deleted or renamed out from under us has nothing to lint.
if (!file || !LINTABLE.test(file) || !existsSync(file)) pass();

const cwd = configDirFor(file);
if (!cwd) pass();

const eslint = join(repoRoot, 'node_modules', '.bin', 'eslint');
if (!existsSync(eslint)) pass(); // Fresh worktree with no install yet.

try {
  execFileSync(
    eslint,
    ['--no-warn-ignored', '--max-warnings', '0', relative(cwd, resolve(file))],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
  );
} catch (err) {
  // Status 1 is "found problems"; anything else means ESLint itself fell
  // over (a broken config, an unresolvable project reference), which is
  // not the edit's fault and must not block it.
  if (err.status !== 1) pass();
  const report = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
  process.stderr.write(
    `${report}\n\n` +
      `This workspace is at 0 errors and 0 warnings — see the linting ` +
      `section of CLAUDE.md. Fix the problem above rather than ` +
      `suppressing it; an eslint-disable needs a "--" rationale saying ` +
      `why the rule cannot apply here.\n`
  );
  process.exit(2);
}

pass();
