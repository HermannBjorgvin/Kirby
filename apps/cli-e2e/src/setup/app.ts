import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@microsoft/tui-test';
import type { Terminal } from '@microsoft/tui-test/lib/terminal/term.js';
import { createTestRepo, registerCleanup } from './git-repo.js';
import { TEST_REPO } from './constants.js';

// Shared helpers for e2e tests. See the plan at
// .claude/plans/sequential-meandering-pearl.md §1 for the design brief.
//
// The timings and wait durations in this module match the duplicated
// inline versions verbatim (typeText 80ms/char, branch-picker 2s
// re-render wait, etc.). Do not tune them down without verifying
// every consuming test still passes; tui-test + Ink's useInput
// interactions are sensitive to React render settle.

/** Absolute path to the built cli entry point. One source of truth. */
export const MAIN_JS: string = resolve('../cli/dist/main.js');

export interface TestEnv {
  /** Git repo tmpdir — passed as the positional arg to `kirby`. */
  dir: string;
  /** Fake $HOME — contains ~/.kirby/config.json. */
  home: string;
  /** KIRBY_LOG destination. Useful for post-mortem when a test hangs. */
  log: string;
}

export interface EnvOptions {
  /**
   * Starting config. A string is treated as a keybind preset id
   * (`'vim'` or `'normie'`) and written as `{ keybindPreset }`. An
   * object is written verbatim as `config.json`. Defaults to `'vim'`
   * because five of the six existing fast tests use that preset; pass
   * `'normie'` or `{}` for tests that want the out-of-the-box preset.
   */
  config?: string | Record<string, unknown>;
  /**
   * Suffix for the mkdtemp + log filenames, purely for debugging —
   * e.g. `'modal-routing'` makes leftover tmpdirs easy to identify if
   * cleanup fails. Defaults to `'e2e'`.
   */
  scope?: string;
}

/**
 * Write `~/.kirby/config.json` with the given contents, creating the
 * directory if needed. Used by `createIsolatedTestEnv` and by tests
 * that need to override config mid-describe.
 */
export function writeKirbyConfig(
  home: string,
  config: Record<string, unknown>
): void {
  const kirbyDir = join(home, '.kirby');
  mkdirSync(kirbyDir, { recursive: true });
  writeFileSync(join(kirbyDir, 'config.json'), JSON.stringify(config), 'utf-8');
}

/**
 * Write the per-project config that `readConfig()` resolves `vendor`
 * and `vendorProject` from. Kirby doesn't store project config in
 * `<projectDir>/.kirby/config.json` (a natural-looking place) — it
 * stores it under the GLOBAL kirby dir keyed by a hash of the project
 * path:
 *
 *   <home>/.kirby/projects/<sha256(projectDir).slice(0,16)>/config.json
 *
 * See `projectConfigPath` in libs/vcs/core/src/lib/config-store.ts.
 * This helper reproduces that path so tests can pre-seed the project
 * config without launching Kirby first.
 */
export function writeProjectKirbyConfig(
  home: string,
  projectDir: string,
  config: Record<string, unknown>
): void {
  const key = createHash('sha256')
    .update(projectDir)
    .digest('hex')
    .slice(0, 16);
  const dir = join(home, '.kirby', 'projects', key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config), 'utf-8');
}

/**
 * Standard test environment: a fresh empty git repo, a fake $HOME
 * with ~/.kirby/config.json, and a KIRBY_LOG path. Cleanup handlers
 * registered at module scope via `registerCleanup`.
 *
 * The bodies of five existing test files built the same thing
 * inline — this consolidates them.
 */
export function createIsolatedTestEnv(options: EnvOptions = {}): TestEnv {
  const scope = options.scope ?? 'e2e';
  const dir = createTestRepo();
  const home = mkdtempSync(join(tmpdir(), `kirby-${scope}-home-`));
  const log = join(tmpdir(), `kirby-${scope}-${Date.now()}.log`);
  registerCleanup(dir);
  registerCleanup(home);

  const config =
    options.config === undefined
      ? { keybindPreset: 'vim' }
      : typeof options.config === 'string'
      ? { keybindPreset: options.config }
      : options.config;
  writeKirbyConfig(home, config);

  return { dir, home, log };
}

/**
 * Type each character with an 80ms gap between so Ink's useInput
 * processes them as individual keypresses instead of a paste. Same
 * timing as the six inline copies this replaces.
 */
export async function typeText(
  terminal: { write: (s: string) => void },
  text: string,
  options: { delayMs?: number } = {}
): Promise<void> {
  const delayMs = options.delayMs ?? 80;
  for (const ch of text) {
    terminal.write(ch);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

/**
 * `'s'` then wait for the Settings header to appear. Callers close
 * with `terminal.keyEscape()` themselves — behaviour around the close
 * varies per test (some want the sidebar `quit` hint assertion, some
 * don't) so we don't bundle it.
 */
export async function openSettings(terminal: Terminal): Promise<void> {
  terminal.write('s');
  await expect(terminal.getByText('Settings', { strict: false })).toBeVisible();
}

/**
 * `'c'` → type branch name → wait `'(new branch)'` hint → 2s
 * re-render settle → Enter → wait picker gone → wait session row
 * visible. The 2s settle is load-bearing: without it the Enter
 * keystroke races Ink's useInput closure refresh with the updated
 * `branchFilter`.
 */
export async function openBranchPickerAndCreate(
  terminal: Terminal,
  branchName: string,
  options: {
    reRenderDelayMs?: number;
    waitSessionTimeoutMs?: number;
  } = {}
): Promise<void> {
  const reRenderDelayMs = options.reRenderDelayMs ?? 2_000;
  const waitSessionTimeoutMs = options.waitSessionTimeoutMs ?? 10_000;

  terminal.write('c');
  await expect(terminal.getByText('Branch Picker')).toBeVisible();

  await typeText(terminal, branchName);
  await expect(
    terminal.getByText('(new branch)', { strict: false })
  ).toBeVisible({ timeout: 5_000 });

  await new Promise((r) => setTimeout(r, reRenderDelayMs));
  terminal.write('\r');

  await expect(terminal.getByText('Branch Picker')).not.toBeVisible({
    timeout: 5_000,
  });
  await expect(terminal.getByText(branchName, { strict: false })).toBeVisible({
    timeout: waitSessionTimeoutMs,
  });
}

/**
 * `'x'` → wait 'to confirm' → type branch name → 2s settle → Enter
 * → wait `(no sessions)`. Matches every existing inline delete flow.
 *
 * If the sidebar has remaining sessions after the delete, don't use
 * this helper — the final `(no sessions)` assertion won't hold.
 */
export async function deleteSelectedSession(
  terminal: Terminal,
  branchName: string
): Promise<void> {
  terminal.write('x');
  await expect(terminal.getByText('to confirm', { strict: false })).toBeVisible(
    { timeout: 10_000 }
  );

  await typeText(terminal, branchName);
  await new Promise((r) => setTimeout(r, 2_000));
  terminal.write('\r');

  await expect(terminal.getByText('(no sessions)')).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Clone the test repo into `cloneDir`, rewrite the remote URL with
 * the `x-access-token` PAT so subsequent git commands authenticate,
 * and set git user.email/name. Throws if `GH_TOKEN` is unset — tests
 * using this must be gated on `hasGhToken`.
 */
export function cloneTestRepoWithAuth(
  cloneDir: string,
  repoFullName: string = TEST_REPO
): void {
  const token = process.env.GH_TOKEN;
  if (!token) {
    throw new Error(
      'cloneTestRepoWithAuth requires GH_TOKEN — gate this test on hasGhToken'
    );
  }
  execSync(
    `git clone "https://x-access-token:${token}@github.com/${repoFullName}.git" "${cloneDir}"`,
    { stdio: 'pipe' }
  );
  execSync(
    `git remote set-url origin "https://x-access-token:${token}@github.com/${repoFullName}.git"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
  execSync('git config user.email "e2e@kirby.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}
