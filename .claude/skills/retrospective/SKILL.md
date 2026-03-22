# Retrospective Command - Claude Code

| targets | description                                                          |
| ------- | -------------------------------------------------------------------- |
| \*      | Analyze completed implementation to identify AI tooling improvements |

Analyze a completed implementation to identify improvements for AI tooling and workflows.

## When to Use

Run this command after completing a significant implementation, especially when:

- A PR has been reviewed and feedback addressed
- Multiple iterations were needed to get something right
- You encountered unexpected issues or made mistakes

---

## Phase 1: Identify the Branch

### Step 1.1: Determine the Branch

```bash
git branch --show-current
```

**If on `main` or the branch is unclear, ASK THE USER:**

> "What branch should I analyze? (The current branch is `main` which suggests the work may have been merged already)"

---

## Phase 2: Gather Chat History Context

### Step 2.1: Find All Chat Sessions for the Branch

Search for all Claude Code sessions that worked on this branch:

```bash
BRANCH="[branch-name]"

find ~/.claude/projects -name "*.jsonl" -size +0 -exec sh -c '
  if head -500 "$1" 2>/dev/null | grep -q "\"gitBranch\":\"'"$BRANCH"'\""; then
    echo "$1"
  fi
' _ {} \; 2>/dev/null
```

**Note:** This searches ALL Claude Code projects. The same branch may have been worked on from multiple directories. We want all sessions regardless of where they started.

### Step 2.2: Extract Key Conversations

For each session file found:

```bash
cat SESSION_FILE | jq -r 'select(.type == "user") | .message.content' 2>/dev/null | head -200
```

### Step 2.3: Analyze Chat Histories

Review ALL found sessions to understand:

- What was the initial task/request?
- What was the original plan?
- What iterations were needed?
- What mistakes were made and corrected?
- How did the approach evolve across sessions?

---

## Phase 3: Gather PR Review Context

### Step 3.1: Find the PR

```bash
gh pr list --head [branch-name] --json number,title,url,state
```

**If no PR found or multiple PRs, ASK THE USER.**

### Step 3.2: Fetch PR Review Comments

```bash
gh pr view [PR-NUMBER] --json number,title,url,state,mergedAt,createdAt

gh api repos/[owner]/[repo]/pulls/[PR-NUMBER]/comments --paginate
```

### Step 3.3: Categorize Review Comments

Organize by:

- **AI reviewers** (coderabbitai, cursor) - valid feedback vs false positives
- **Human reviewers** - note all feedback (this is gold)
- **Resolved vs unresolved** threads

---

## Phase 4: Present Context and Get User Input

### Step 4.1: Present Overview

Show the user what you've gathered:

```markdown
## Context Gathered

### Chat Sessions Found

- [List sessions with brief descriptions]

### PR Review Summary

- **PR:** #[number] - [title]
- **AI Reviewer Comments:** [count]
- **Human Reviewer Comments:** [count]
- **Key Feedback:** [brief list]
```

### Step 4.2: Ask for Additional Context

> "Is there anything else I should know? Any context top of mind about how this went?"

### Step 4.3: Get Permission

> "I have all the context. Should I proceed with the analysis?"

---

## Phase 5: Timeline Analysis

### Step 5.1: Build the Timeline

```bash
# First commit on branch
git log main..[branch] --oneline --reverse | head -1

# All commits with dates
git log main..[branch] --format="%h %ad %s" --date=short

# Files modified
git diff --stat main...[branch]

# PR dates
gh pr view [PR-NUMBER] --json createdAt,mergedAt
```

### Step 5.2: Present Timeline

```markdown
## Timeline

- **Started:** [date]
- **PR Created:** [date]
- **PR Merged:** [date]
- **Duration:** [X days]
- **Commits:** [count]
- **Files Modified:** [count]
```

---

## Phase 6: Retrospective Analysis

### Step 6.1: What Went Well

Identify successes:

- One-shot implementations
- Effective pattern reuse
- Good context that prevented mistakes

For each: **Why did it work? Is it repeatable?**

### Step 6.2: What Went Wrong (5 Whys Analysis)

**For each issue, apply Toyota's 5 Whys to find the root cause.**

Keep asking "why" until you reach something actionable.

**Example:**

```
Problem: Double URL encoding caused API failures

Why 1: We encoded params, but HTTP client also encoded them
Why 2: We didn't know the client auto-encodes
Why 3: We didn't test the actual HTTP request
Why 4: We assumed correct because it "looked right"
Why 5: No integration test verified actual API calls

ROOT CAUSE: No test verified actual HTTP request/response
ACTION: Add integration test for API calls
```

**Anti-patterns to avoid:**

- ❌ "We need more documentation" - usually a symptom
- ❌ "I made a mistake" - too surface-level
- ❌ "We didn't know X" - ask why the gap existed
- ✅ Good root causes → tests, automation, process changes

**Output format:**

```markdown
### [Issue]

**Problem:** [One-line description]

**5 Whys:**

1. Why? [cause]
2. Why? [cause]
3. Why? [cause]
4. Why? [cause]
5. Why? [root cause]

**Root Cause:** [actionable cause]
**How Discovered:** Self / PR review / User feedback
```

---

## Phase 7: Generate Recommendations

### Step 7.0: Filter - What's Worth a Rule?

**CRITICAL: Don't create rules for general coding practices.**

**❌ DON'T create rules for:**

- Generic best practices (null checks, error handling)
- "Remember to test your code" - too obvious
- "Verify assumptions" - too vague
- Things AI will naturally improve at

**✅ DO create rules for:**

- **Codebase-specific patterns** unique to YOUR repo
- **Your process/workflow** - how your team works
- **Common pitfalls** in your specific codebase
- **Domain knowledge** that isn't obvious

**Test:** "Would a senior engineer joining need to be told this?"

- If they'd figure it out → Don't create a rule
- If it's tribal knowledge → Create a rule

### Step 7.1: Generalize from Incidents

The exact scenario won't repeat. Abstract to categories:

| Specific (Bad)                    | General (Good)                                  |
| --------------------------------- | ----------------------------------------------- |
| "Check Stripe webhook signatures" | "Verify authenticity of external webhooks"      |
| "Test empty array for events"     | "Test boundary conditions: empty, single, many" |

**Test:** "Would this help in 3+ different situations?"

### Step 7.2: Output Recommendations

```markdown
### Recommendation: [Title]

**Type:** rule | skill | stop-hook | checklist

**Confidence:** High | Medium | Low

**Specific Incident:**
[What actually happened]

**Generalized Principle:**
[The broader category]

**Proposed Change:**
[Content to add]

**Evidence:**
[Examples from PR/conversation]
```

---

## Phase 8: Action Items

```markdown
## Action Items

### High Priority

- [ ] [File] - [Change]

### Medium Priority

- [ ] [File] - [Change]

### Low Priority

- [ ] [File] - [Change]
```

**ASK:** "Would you like me to implement any of these now?"

---

## Output Format

```markdown
# Retrospective: [Branch/PR Name]

## Summary

[1-2 sentences]

## Timeline

[Key dates]

## What Went Well

[Successes]

## What Went Wrong

[Issues with 5 Whys analysis]

## Recommendations

[Generalized improvements]

## Action Items

[Prioritized changes]
```

---

## Notes

- **Generalize** - The exact scenario won't repeat, but the category will
- Focus on **actionable** recommendations
- Test: "Would this help in 3+ situations?" If not, generalize further
- Human reviewer feedback is especially valuable - these are insights your AI missed
- Don't claim user corrections as AI successes
