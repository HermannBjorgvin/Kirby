#!/usr/bin/env node
/**
 * A stand-in for the `gh` CLI, so the pull-request half of the app can
 * be driven offline.
 *
 * The GitHub provider reaches GitHub only by running `gh` (see
 * libs/vcs/github/src/lib/provider.ts — every call is `execFile('gh',
 * …)`), which means putting this on PATH ahead of the real one hands
 * the app a whole pull request, its review threads and its description
 * without a network, a token, or a change to a line of production
 * code. Before it existed, everything downstream of a PR — the review
 * workspace, the diff, comment threads, drafts, and now the plan — was
 * reachable only from the @integration suite, which needs a token and
 * therefore does not run on most pull requests.
 *
 * The scenario is a JSON file named by KIRBY_FAKE_GH; its shape is
 * documented in setup/fake-gh.ts. Anything not in it answers with an
 * empty result rather than failing, so a test declares only what it
 * cares about.
 */
import { readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync(process.env.KIRBY_FAKE_GH, 'utf8'));
const prs = scenario.prs ?? [];
const argv = process.argv.slice(2);

const out = (value) => {
  process.stdout.write(
    typeof value === 'string' ? value : JSON.stringify(value)
  );
  process.exit(0);
};

/** `-f k=v` / `-F k=n` pairs, as gh itself collects them. */
function flags(args) {
  const map = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-f' || args[i] === '-F') {
      const eq = (args[i + 1] ?? '').indexOf('=');
      if (eq > 0) map[args[i + 1].slice(0, eq)] = args[i + 1].slice(eq + 1);
      i++;
    }
  }
  return map;
}

const page = { hasNextPage: false, endCursor: null };

function searchNode(pr) {
  return {
    number: pr.number,
    title: pr.title,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName ?? 'main',
    headRefOid: pr.headRefOid ?? 'f'.repeat(40),
    url: `https://github.com/${scenario.owner ?? 'kirby'}/${
      scenario.repo ?? 'fixture'
    }/pull/${pr.number}`,
    author: { login: pr.author ?? scenario.username ?? 'kirby-tester' },
    isDraft: pr.isDraft ?? false,
    reviews: {
      nodes: (pr.reviews ?? []).map((r) => ({
        author: { login: r.author },
        state: r.state,
      })),
    },
    reviewRequests: {
      nodes: (pr.reviewRequests ?? []).map((login) => ({
        requestedReviewer: { login },
      })),
    },
    reviewThreads: {
      nodes: (pr.threads ?? []).map((t) => ({
        isResolved: t.isResolved ?? false,
      })),
    },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: pr.rollup ? { state: pr.rollup } : null,
          },
        },
      ],
    },
  };
}

function threadNode(t, i) {
  return {
    id: t.id ?? `thread-${i + 1}`,
    isResolved: t.isResolved ?? false,
    isOutdated: t.isOutdated ?? false,
    path: t.path ?? null,
    line: t.line ?? null,
    startLine: t.startLine ?? null,
    originalLine: t.originalLine ?? null,
    originalStartLine: null,
    diffSide: t.side ?? 'RIGHT',
    comments: {
      nodes: (t.comments ?? []).map((c, j) => ({
        id: `${t.id ?? `thread-${i + 1}`}-c${j + 1}`,
        author: { login: c.author },
        body: c.body,
        createdAt: c.createdAt ?? '2026-01-01T00:00:00Z',
        isMinimized: false,
      })),
    },
  };
}

// ── gh auth status ──
if (argv[0] === 'auth' && argv[1] === 'status') {
  out(
    `github.com\n  ✓ Logged in to github.com account ${
      scenario.username ?? 'kirby-tester'
    } (keyring)\n`
  );
}

// ── gh api graphql ──
if (argv[0] === 'api' && argv[1] === 'graphql') {
  const vars = flags(argv);
  const query = vars.query ?? '';

  // The open-PR search is the only one asking for a check rollup; the
  // merged-branch sweep asks for headRefName alone and gets nothing,
  // which keeps the sync loop from deleting a test's branches.
  if (query.includes('statusCheckRollup')) {
    out({ data: { search: { pageInfo: page, nodes: prs.map(searchNode) } } });
  }
  if (query.includes('search(')) {
    out({ data: { search: { pageInfo: page, nodes: [] } } });
  }

  if (query.includes('reviewThreads(first: 100, after: $threadCursor)')) {
    const pr = prs.find((p) => String(p.number) === String(vars.prNumber));
    out({
      data: {
        repository: {
          pullRequest: {
            id: `PR_${vars.prNumber}`,
            reviewThreads: {
              pageInfo: page,
              nodes: (pr?.threads ?? []).map(threadNode),
            },
            comments: {
              pageInfo: page,
              nodes: (pr?.generalComments ?? []).map((c, i) => ({
                id: `general-${i + 1}`,
                author: { login: c.author },
                body: c.body,
                createdAt: c.createdAt ?? '2026-01-01T00:00:00Z',
              })),
            },
          },
        },
      },
    });
  }

  // Mutations (reply, resolve). Nothing reads the payload back.
  out({ data: {} });
}

// ── gh api repos/<owner>/<repo>/pulls/<n> --jq '.body // ""' ──
const pullPath = argv[1]?.match(/^repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/);
if (argv[0] === 'api' && pullPath) {
  const pr = prs.find((p) => String(p.number) === pullPath[1]);
  out(pr?.body ?? '');
}

if (argv[0] === 'api' && argv[1] === '/user') {
  out({ login: scenario.username ?? 'kirby-tester' });
}

process.stderr.write(`fake gh: unhandled invocation: ${argv.join(' ')}\n`);
process.exit(1);
