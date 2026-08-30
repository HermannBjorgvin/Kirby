import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * A pull request as a test declares it. Only `number`, `title` and
 * `headRefName` are needed; everything else has a sane default.
 *
 * `headRefName` should be a branch that exists in the test repo, so the
 * diff the workspace loads is a real one computed by git.
 */
export interface FakePr {
  number: number;
  title: string;
  headRefName: string;
  baseRefName?: string;
  /** Defaults to the scenario's username, which makes it *your* PR and
   *  puts it under "Pull Requests" rather than a review bucket. */
  author?: string;
  isDraft?: boolean;
  /** Body shown on the Overview pane. */
  body?: string;
  rollup?: 'SUCCESS' | 'FAILURE' | 'PENDING';
  reviews?: { author: string; state: string }[];
  reviewRequests?: string[];
  threads?: FakeThread[];
  generalComments?: { author: string; body: string }[];
}

/** An inline review thread, anchored to a file and line in the diff. */
export interface FakeThread {
  id?: string;
  path: string;
  line: number;
  startLine?: number;
  /** Set with `line: null` semantics by leaving `line` off — see the
   *  outdated-thread case in the TUI suite. */
  originalLine?: number;
  isResolved?: boolean;
  isOutdated?: boolean;
  side?: 'LEFT' | 'RIGHT';
  comments: { author: string; body: string; createdAt?: string }[];
}

export interface FakeGitHub {
  owner?: string;
  repo?: string;
  /** The signed-in user. PRs they authored are "yours". */
  username?: string;
  prs: FakePr[];
  /**
   * Make every `gh` call take this long, standing in for the round trip
   * to GitHub. Left off for the e2e suite (which wants speed); the perf
   * suite sets it, because a provider that answers in a millisecond
   * hides what the app does with the window while it waits.
   */
  latencyMs?: number;
}

/**
 * Install a fake `gh` for one test.
 *
 * Returns the environment additions the app must be launched with: a
 * bin directory at the front of PATH holding an executable named `gh`,
 * and the scenario it should answer from. The GitHub provider shells
 * out to `gh` for every remote call, so this is the whole seam — no
 * production code knows it is under test.
 */
export function installFakeGh(
  homeDir: string,
  scenario: FakeGitHub
): { PATH: string; KIRBY_FAKE_GH: string; KIRBY_FAKE_GH_LATENCY_MS?: string } {
  const binDir = join(homeDir, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const gh = join(binDir, 'gh');
  copyFileSync(join(HERE, '..', 'fixtures', 'fake-gh.mjs'), gh);
  chmodSync(gh, 0o755);

  const scenarioPath = join(homeDir, 'fake-gh.json');
  writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2), 'utf8');

  return {
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    KIRBY_FAKE_GH: scenarioPath,
    ...(scenario.latencyMs
      ? { KIRBY_FAKE_GH_LATENCY_MS: String(scenario.latencyMs) }
      : {}),
  };
}

/**
 * The per-project config that points the app at the fake. `vendorProject`
 * must be present or the host auto-detects from the git remote and
 * overwrites it.
 */
export function fakeGhProjectConfig(
  scenario: FakeGitHub
): Record<string, unknown> {
  return {
    vendor: 'github',
    vendorProject: {
      owner: scenario.owner ?? 'kirby',
      repo: scenario.repo ?? 'fixture',
      username: scenario.username ?? 'kirby-tester',
    },
  };
}
