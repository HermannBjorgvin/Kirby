---
name: review-pr
description: Review a GitHub pull request with gh. Use for PR review, inline comments, approval, or requested changes.
---

# Review a pull request

Use `gh` to inspect metadata, the diff and existing reviews:

```sh
gh pr view <number> --json title,body,files,baseRefName,headRefOid,headRepositoryOwner,headRepository
gh pr diff <number>
gh repo view --json nameWithOwner
gh api repos/OWNER/REPO/pulls/NUMBER/reviews
gh api --paginate repos/OWNER/REPO/pulls/NUMBER/comments
```

Read the applicable `AGENTS.md` files and enough surrounding code to verify
suspected issues. Prioritize actionable regressions; explain the trigger and
impact with file and line references. State any checks you could not run.

Return findings in the conversation unless the user requested a GitHub review
or comments. A request to inspect and fix a branch does not require posting.

## Post when requested

Use the base repository's `OWNER/REPO` and current PR head SHA. Inline `line`
is the actual file line, not a diff position; `side` is `RIGHT` for new code
or `LEFT` for removed code. Use the REST API because `gh pr review` cannot
attach inline comments.

Write a JSON payload to a temporary file, then submit it:

```sh
gh api repos/OWNER/REPO/pulls/NUMBER/reviews --input /tmp/kirby-review.json
```

Payload fields: `commit_id`, `body`, `event` (`COMMENT`, `APPROVE`, or
`REQUEST_CHANGES`), and an optional `comments` array of
`{path, line, side, body}`. Check existing reviews to avoid duplicates. To change
status after posting comments, submit a new review without the `comments` array.

Write posted bodies as Conventional Comments: `<label> [decorations]: <subject>`,
then the explanation. End each posted body with:

```markdown
---

_Posted via [Kirby](https://github.com/HermannBjorgvin/Kirby) by an agent_
```
