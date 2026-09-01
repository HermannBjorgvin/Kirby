/**
 * The staged world the README captures run against: a small TypeScript
 * repo with worktrees, a fake `gh` serving two pull requests with
 * review threads, and agent-drafted review comments on one of them.
 *
 * Everything is offline and deterministic except timestamps, which are
 * computed relative to now so cards read "2h ago" instead of a stale
 * absolute date.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'src', 'fixtures');

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

// ── Source files ─────────────────────────────────────────────────

const KEYBOARD_BASE = `import { commands } from './commands';

export function bindGlobalKeys(target: HTMLElement) {
  target.addEventListener('keydown', (event) => {
    if (event.metaKey && event.key === 's') {
      event.preventDefault();
      commands.run('workspace.save');
    }
  });
}
`;

const KEYBOARD_PR = `import { commands } from './commands';
import { openPalette } from './palette';

export function bindGlobalKeys(target: HTMLElement) {
  target.addEventListener('keydown', (event) => {
    if (event.metaKey && event.key === 's') {
      event.preventDefault();
      commands.run('workspace.save');
    }
    if (event.metaKey && event.key === 'k') {
      event.preventDefault();
      openPalette();
    }
  });
}
`;

const PALETTE_PR = `import { commands, type Command } from './commands';

let query = '';
let open = false;

export function openPalette() {
  open = true;
  query = '';
  render();
}

export function filterCommands(q: string): Command[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return commands.list();
  return commands
    .list()
    .filter((c) => c.title.toLowerCase().includes(needle));
}

export function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    open = false;
    render();
    return;
  }
  query = applyKey(query, event);
  render();
}

function applyKey(q: string, event: KeyboardEvent): string {
  if (event.key === 'Backspace') return q.slice(0, -1);
  if (event.key.length === 1) return q + event.key;
  return q;
}

function render() {
  const results = filterCommands(query);
  commands.emit('palette.render', { open, query, results });
}
`;

const SESSION_BASE = `import { store } from './store';

export interface Session {
  id: string;
  startedAt: number;
}

export function saveSession(session: Session) {
  store.set('session', JSON.stringify(session));
}

export function restoreSession(): Session | null {
  const raw = store.get('session');
  if (!raw) return null;
  return JSON.parse(raw) as Session;
}
`;

const SESSION_PR = `import { store } from './store';

export interface Session {
  id: string;
  startedAt: number;
  /** Bumped on every save; a resume with a stale seq is discarded. */
  seq: number;
}

export function saveSession(session: Session) {
  store.set('session', JSON.stringify(session));
}

export function restoreSession(): Session | null {
  const raw = store.get('session');
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Session;
  const live = store.get('session.live');
  if (live && JSON.parse(live).seq > parsed.seq) {
    return JSON.parse(live) as Session;
  }
  return parsed;
}
`;

// ── The world ────────────────────────────────────────────────────

export function buildScenario() {
  const parent = mkdtempSync(join(tmpdir(), 'kirby-demo-'));
  const repo = join(parent, 'atlas');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'demo@kirby.dev']);
  git(repo, ['config', 'user.name', 'Kirby Demo']);
  git(repo, ['config', 'commit.gpgsign', 'false']);

  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'atlas', version: '0.4.2', private: true }, null, 2)
  );
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'keyboard.ts'), KEYBOARD_BASE);
  writeFileSync(join(repo, 'src', 'session.ts'), SESSION_BASE);
  writeFileSync(
    join(repo, 'src', 'commands.ts'),
    `export interface Command {\n  id: string;\n  title: string;\n}\n`
  );
  writeFileSync(join(repo, 'README.md'), '# atlas\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'chore: scaffold']);

  const worktree = (branch, mutate) => {
    const path = join(repo, '.claude', 'worktrees', branch);
    git(repo, ['worktree', 'add', '-q', path, '-b', branch]);
    mutate(path);
    git(path, ['add', '.']);
    git(path, ['commit', '-q', '-m', `feat: ${branch}`]);
  };

  /** A branch with a commit but no worktree: a pull request you have
   *  not checked out yet. */
  const branchOnly = (branch, mutate) => {
    const path = join(repo, '.claude', 'tmp-' + branch);
    git(repo, ['worktree', 'add', '-q', path, '-b', branch]);
    mutate(path);
    git(path, ['add', '.']);
    git(path, ['commit', '-q', '-m', `feat: ${branch}`]);
    git(repo, ['worktree', 'remove', '--force', path]);
  };

  worktree('command-palette', (p) => {
    writeFileSync(join(p, 'src', 'palette.ts'), PALETTE_PR);
    writeFileSync(join(p, 'src', 'keyboard.ts'), KEYBOARD_PR);
  });
  worktree('session-restore', (p) => {
    writeFileSync(join(p, 'src', 'session.ts'), SESSION_PR);
  });
  // Two pull requests with nothing checked out, purely so the sidebar
  // shows what CI and review state look like: one whose build is
  // failing, one that is approved and green.
  branchOnly('retry-backoff', (p) => {
    writeFileSync(
      join(p, 'src', 'retry.ts'),
      `export async function retry<T>(fn: () => Promise<T>, times = 3) {\n` +
        `  for (let i = 0; ; i++) {\n` +
        `    try {\n      return await fn();\n    } catch (err) {\n` +
        `      if (i >= times) throw err;\n` +
        `      await new Promise((r) => setTimeout(r, 2 ** i * 100));\n` +
        `    }\n  }\n}\n`
    );
  });
  branchOnly('keyboard-nav', (p) => {
    writeFileSync(
      join(p, 'src', 'focus.ts'),
      `export function focusNext(items: HTMLElement[], from: number) {\n` +
        `  items[(from + 1) % items.length]?.focus();\n}\n`
    );
  });

  // A PR-less worktree, so the sidebar shows its Worktrees section.
  worktree('perf-flamegraph', (p) => {
    writeFileSync(
      join(p, 'src', 'profile.ts'),
      `export function mark(label: string) {\n  performance.mark(label);\n}\n`
    );
  });

  // A bare origin, so the sync loop's \`git fetch\` succeeds and the
  // status bar reads "synced" instead of an error state.
  const origin = join(parent, 'atlas-origin.git');
  git(parent, ['clone', '-q', '--bare', repo, origin]);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['fetch', '-q', 'origin']);

  // ── HOME ──
  const home = mkdtempSync(join(tmpdir(), 'kirby-demo-home-'));
  const kirby = join(home, '.kirby');
  mkdirSync(kirby, { recursive: true });
  writeFileSync(
    join(kirby, 'config.json'),
    JSON.stringify(
      {
        aiCommand: `node ${join(HERE, 'demo-agent.mjs')}`,
        // A capture wants agents that die with the run, not agents that
        // persist. Left unset, the backend resolves to tmux wherever
        // tmux is installed, and closing the app only detaches — so
        // every recording would strand a demo agent on a tmux server
        // whose socket dir the teardown then deletes.
        terminalBackend: 'pty',
      },
      null,
      2
    )
  );
  const key = createHash('sha256').update(repo).digest('hex').slice(0, 16);
  const projDir = join(kirby, 'projects', key);
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, 'config.json'),
    JSON.stringify(
      {
        vendor: 'github',
        vendorProject: { owner: 'acme', repo: 'atlas', username: 'hermannb' },
      },
      null,
      2
    )
  );

  // Agent-drafted review comments on #131, as `kirby util add-comment`
  // leaves them.
  const draftsDir = join(kirby, 'reviews', 'pr-131');
  mkdirSync(draftsDir, { recursive: true });
  writeFileSync(
    join(draftsDir, 'comments.json'),
    JSON.stringify(
      {
        prId: 131,
        comments: [
          {
            id: 'd-race',
            file: 'src/session.ts',
            lineStart: 22,
            lineEnd: 22,
            severity: 'critical',
            body: '`restoreSession` parses `session.live` twice — once for the seq check and again for the return. If the store mutates between the two reads, the seq that won the comparison is not the object you return.',
            side: 'RIGHT',
            status: 'draft',
            createdAt: hoursAgo(0.2),
          },
          {
            id: 'd-shape',
            file: 'src/session.ts',
            lineStart: 8,
            lineEnd: 8,
            severity: 'major',
            body: 'Sessions saved before this change have no `seq`. `JSON.parse` gives `undefined`, and `undefined > n` is false — so every legacy session silently loses to any live one. Worth defaulting to 0 on read.',
            side: 'RIGHT',
            status: 'draft',
            createdAt: hoursAgo(0.2),
          },
          {
            id: 'd-nit',
            file: 'src/session.ts',
            lineStart: 25,
            lineEnd: 25,
            severity: 'nit',
            body: 'Nit: `JSON.parse(live)` runs twice on this path; hoisting it also gives the variable a name for the comment above.',
            side: 'RIGHT',
            status: 'draft',
            createdAt: hoursAgo(0.2),
          },
        ],
      },
      null,
      2
    )
  );

  // ── fake gh ──
  const binDir = join(home, 'bin');
  mkdirSync(binDir);
  const gh = join(binDir, 'gh');
  copyFileSync(join(FIXTURES, 'fake-gh.mjs'), gh);
  chmodSync(gh, 0o755);
  const scenarioPath = join(home, 'fake-gh.json');
  writeFileSync(scenarioPath, JSON.stringify(github(), null, 2));

  return {
    repo,
    home,
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      KIRBY_FAKE_GH: scenarioPath,
    },
  };
}

function github() {
  return {
    owner: 'acme',
    repo: 'atlas',
    username: 'hermannb',
    prs: [
      {
        number: 128,
        title: 'Add a command palette',
        headRefName: 'command-palette',
        baseRefName: 'main',
        author: 'hermannb',
        rollup: 'SUCCESS',
        body:
          'A ⌘K palette over the command registry.\n\n' +
          '- fuzzy-ish substring filter over command titles\n' +
          '- `Escape` closes\n\nCloses #97.',
        reviews: [{ author: 'sofia-codes', state: 'COMMENTED' }],
        threads: [
          {
            id: 'T-filter',
            path: 'src/palette.ts',
            line: 15,
            comments: [
              {
                author: 'sofia-codes',
                body: 'This filter runs the whole command list on every keystroke. Fine today, but the registry grows per plugin — can we memoize per query prefix so backspace is free?',
                createdAt: hoursAgo(5),
              },
              {
                author: 'marcusv',
                body: 'Agreed — a prefix cache keeps this simple. fuzzysort is overkill at this size.',
                createdAt: hoursAgo(4),
              },
            ],
          },
          {
            id: 'T-escape',
            path: 'src/palette.ts',
            line: 27,
            comments: [
              {
                author: 'marcusv',
                body: 'Escape closes but keeps the old query, so reopening shows stale results for a beat. Clearing on close feels much better.',
                createdAt: hoursAgo(3),
              },
            ],
          },
        ],
        generalComments: [
          {
            author: 'sofia-codes',
            body: 'Tried it on the big workspace — feels instant. Two small things inline.',
            createdAt: hoursAgo(5),
          },
        ],
      },
      {
        number: 124,
        title: 'Retry transient network failures with backoff',
        headRefName: 'retry-backoff',
        baseRefName: 'main',
        author: 'hermannb',
        // Red in the sidebar: a failing build escalates a row whatever
        // the reviewers think of it.
        rollup: 'FAILURE',
        body: 'Exponential backoff around the transient failures.',
        reviews: [{ author: 'marcusv', state: 'APPROVED' }],
        threads: [],
      },
      {
        number: 119,
        title: 'Roving tabindex for the toolbar',
        headRefName: 'keyboard-nav',
        baseRefName: 'main',
        author: 'hermannb',
        // Green and filled: CI passed and every reviewer approved, which
        // is the only combination that reads as ready to merge.
        rollup: 'SUCCESS',
        body: 'Arrow keys move focus within the toolbar; Tab leaves it.',
        reviews: [{ author: 'sofia-codes', state: 'APPROVED' }],
        threads: [],
      },
      {
        number: 131,
        title: 'Fix flaky session restore on resume',
        headRefName: 'session-restore',
        baseRefName: 'main',
        author: 'sofia-codes',
        rollup: 'SUCCESS',
        body:
          'Resuming from sleep could restore a stale session. Saves now ' +
          'carry a sequence number and restore prefers the live copy.',
        reviewRequests: ['hermannb'],
        threads: [],
      },
    ],
  };
}
