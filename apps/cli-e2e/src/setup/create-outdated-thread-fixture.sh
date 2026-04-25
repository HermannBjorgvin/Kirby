#!/usr/bin/env bash
# Re-create the outdated-thread fixture (PR #322 in the test repo) if
# it ever gets deleted. Idempotent — exits cleanly if the branch /PR
# already exists.
#
# What this script produces:
#   - Branch fixture/outdated-thread on the test repo
#   - PR #N (whichever number the repo assigns) titled "Outdated thread
#     fixture (do not merge)"
#   - One review comment on commit #1, line 10 of
#     outdated-thread-fixture.c
#   - A second commit that rewrites compute_value() so GitHub flags
#     the thread isOutdated: true with line: null and only
#     originalLine surviving.
#
# Used by apps/cli-e2e/src/outdated-thread.test.ts.
#
# Requires: gh CLI authenticated with write access to the test repo.

set -euo pipefail

REPO="${TEST_REPO:-kirby-test-runner/kirby-integration-test-repository}"
BRANCH="fixture/outdated-thread"

if gh api "repos/${REPO}/branches/${BRANCH}" >/dev/null 2>&1; then
  echo "fixture branch ${BRANCH} already exists on ${REPO} — nothing to do."
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

gh repo clone "${REPO}" "${WORK}/repo" >/dev/null 2>&1
cd "${WORK}/repo"

git checkout -b "${BRANCH}" main

cat > outdated-thread-fixture.c <<'C'
#include <stdio.h>

// This file exists to exercise the outdated-thread rendering path.
// The fixture posts a review comment on the original version of
// `compute_value` below, then a follow-up commit changes the line
// the comment was anchored to. GitHub then reports `line: null` and
// only `originalLine` survives in the GraphQL `reviewThreads` query.

static int compute_value(int seed) {
    return seed * 17 + 3;
}

int main(void) {
    int seed = 42;
    int v = compute_value(seed);
    printf("value = %d\n", v);
    return 0;
}
C

git add outdated-thread-fixture.c
git commit -q -m "fixture: add outdated-thread setup file"
FIRST_SHA="$(git rev-parse HEAD)"
git push -q -u origin "${BRANCH}"

PR_URL="$(
  gh pr create \
    --repo "${REPO}" \
    --base main \
    --head "${BRANCH}" \
    --title "Outdated thread fixture (do not merge)" \
    --body "Permanent fixture for kirby's e2e tests. Used by apps/cli-e2e/src/outdated-thread.test.ts to verify the diff viewer renders outdated review threads inline at their originalLine. Do not merge or modify."
)"
PR_NUMBER="${PR_URL##*/}"

echo "created PR #${PR_NUMBER} (${PR_URL}); posting review comment on commit ${FIRST_SHA}, line 10..."

cat <<JSON | gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" --input -
{
  "commit_id": "${FIRST_SHA}",
  "body": "Permanent fixture comment — kirby e2e exercises outdated-thread rendering. Do not delete.",
  "event": "COMMENT",
  "comments": [
    {
      "path": "outdated-thread-fixture.c",
      "line": 10,
      "side": "RIGHT",
      "body": "Fixture comment anchored to the original line 10 ('return seed * 17 + 3;'). A follow-up commit will change this line so GitHub flags the thread as outdated."
    }
  ]
}
JSON

cat > outdated-thread-fixture.c <<'C'
#include <stdio.h>

// This file exists to exercise the outdated-thread rendering path.
// The fixture posts a review comment on the original version of
// `compute_value` below, then a follow-up commit changes the line
// the comment was anchored to. GitHub then reports `line: null` and
// only `originalLine` survives in the GraphQL `reviewThreads` query.

static int compute_value(int seed) {
    int factor = 23;
    int offset = 7;
    int adjusted = seed * factor;
    return adjusted + offset;
}

int main(void) {
    int seed = 42;
    int v = compute_value(seed);
    printf("value = %d\n", v);
    return 0;
}
C

git add outdated-thread-fixture.c
git commit -q -m "fixture: rewrite compute_value (renders prior comment outdated)"
git push -q

echo "fixture ready. verify with:"
echo "  gh api graphql -f query='{ repository(owner:\"${REPO%/*}\", name:\"${REPO#*/}\") { pullRequest(number:${PR_NUMBER}) { reviewThreads(first:5) { nodes { isOutdated line originalLine } } } } }'"
