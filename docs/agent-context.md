# Agent context

`AGENTS.md` is the shared source of repository instructions. Area files add
local rules; `docs/` holds details to read when relevant. Keep commands and
constraints in instructions. Reference docs should explain durable decisions,
not accumulate session history, old measurements or speculative work.

## Loading

- **Codex:** reads `AGENTS.md` along the path from the repository root to its
  starting working directory. Do not assume it loads every descendant file when
  started at the root; the root instructions require reading applicable area files
  before editing. Skills are discovered from `.agents/skills/`.
- **Claude Code:** root and area `CLAUDE.md` files import their sibling
  `AGENTS.md`. `.claude/skills/` links to the shared skills. Plugins, rules and
  the Write/Edit lint hook under `.claude/` are Claude-specific.
- **Other agents:** read `AGENTS.md` and relevant `.agents/skills/*/SKILL.md`
  directly if automatic discovery is unavailable. `.github/skills/` provides
  aliases for clients using that location.

Codex needs no duplicate `CODEX.md` or Claude plugin installation. Run Nx lint
explicitly; the Claude hook provides no enforcement in Codex. Use `npx nx` when
Nx MCP is unavailable.

`publish-beta` preserves explicit-only invocation in both clients:
`disable-model-invocation` in `SKILL.md` for Claude and
`policy.allow_implicit_invocation: false` in `agents/openai.yaml` for Codex.
Loading a skill does not authorize publishing or posting a review.

## Maintenance and verification

Edit shared skills under `.agents/skills/`, not their aliases. Keep area
`CLAUDE.md` imports beside their `AGENTS.md`. Symlink aliases require a checkout
that supports symlinks; Codex's canonical skill directories do not depend on them.

After changing context, check imports, symlink targets, skill frontmatter and
local reference paths. In a fresh Codex session, ask it to list the instruction
sources and skills it sees, then repeat from an area such as `apps/desktop`.
Check that `publish-beta` is available explicitly without automatic activation.

Official references: [Codex instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [skill discovery and invocation policy](https://learn.chatgpt.com/docs/build-skills).
