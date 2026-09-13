---
name: review-pr
description: Review a GitHub pull request from the CLI with gh — gather metadata and diff, post inline review comments through the REST API, and set the review status without duplicating comments. Use when asked to review a PR, leave line comments, request changes, or approve.
---

# Reviewing a pull request with gh

When reviewing a pull request, use `gh` CLI — not the workflow-manager agent.

## Gathering info

- `gh pr view <number> --json title,body,files,headRefOid,headRepositoryOwner,headRepository` — get metadata and the commit SHA needed for the review API
- `gh pr diff <number>` — get the full diff (pipe to a file or read tool if large)
- `gh repo view --json nameWithOwner` — get the `owner/repo` for API calls

## Posting inline review comments

Use the GitHub API directly to post a review with inline comments:

```bash
cat <<'EOF' | gh api repos/OWNER/REPO/pulls/NUMBER/reviews --input -
{
  "commit_id": "<head SHA from gh pr view>",
  "body": "Overall review summary here.",
  "event": "COMMENT",
  "comments": [
    {
      "path": "relative/file/path.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "Comment on the new code at this line."
    }
  ]
}
EOF
```

- `line` is the line number in the **new version** of the file (right side of the diff)
- `side: "RIGHT"` targets the new code; use `"LEFT"` to comment on removed lines
- `event` can be `"COMMENT"`, `"APPROVE"`, or `"REQUEST_CHANGES"`

## Changing review status without duplicating comments

To set "Changes requested" after already posting inline comments, submit a **separate review with no `comments` array** — just `body` and `event`:

```bash
cat <<'EOF' | gh api repos/OWNER/REPO/pulls/NUMBER/reviews --input -
{
  "commit_id": "<head SHA>",
  "body": "Requesting changes — see inline comments.",
  "event": "REQUEST_CHANGES"
}
EOF
```

This adds the blocking status without duplicating any inline comments.

## Things to watch out for

- **Write the body as a Conventional Comment and sign it at the end** — `<label> [decorations]: <subject>`, a blank line, then the discussion, closing with `_Posted via [Kirby](https://github.com/HermannBjorgvin/Kirby) by an agent_` after a `---`. Same shape Kirby's own poster emits (`libs/review-comments/src/lib/conventional.ts`), so a reader can still tell at a glance that a machine wrote it — just not before they can tell what it says
- **Don't use `gh pr review`** for inline comments — it only supports a single body comment, not per-line annotations
- **Line numbers come from the new file**, not diff positions — count from the `@@` hunk headers to get them right
- **Heredoc quoting matters** — use `<<'EOF'` (quoted) to prevent shell expansion inside the JSON body
