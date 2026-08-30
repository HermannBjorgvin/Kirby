# Verification techniques that paid off in this repo

## Prove a spec bites: mutation testing

Never accept "I verified the test by breaking the source". Re-run it. A small
Python driver is far more reliable than `perl -0pi -e "s/.../.../"` — the
replacement text is full of `/`, `!`, `\` and newlines that break shell/perl
quoting and silently produce a no-op mutation that then reads as "test passed,
so it's tautological". The driver should assert the pattern occurs exactly once
before writing, and `git checkout --` after.

Highest-yield mutation targets in this codebase's layout models: comparison
operators at viewport edges (`>=`/`>`, `<=`/`<`), the reserved-indicator-row
constants, and the "everything fits, return early" guard. The last one is
routinely untested because a spec author reaches for the scrolling case.

## Prove the local Ink lint rules still cover a moved component

`tools/eslint-plugin-ink.mjs` resolves `Box`/`Text` through the _import_, so a
component that moved to a new file is only covered if that file imports them
from `'ink'` directly. Verify by appending a deliberate violation and linting:

    import { Box as ProbeBox, Text as ProbeText } from 'ink';
    export function __LintProbe() {
      return (<ProbeBox>raw text<ProbeText><ProbeBox /></ProbeText></ProbeBox>);
    }

Expect 2 errors (`ink/no-raw-text` + `ink/no-layout-inside-text`). Read raw
`npx eslint <file>` output — `--format unix` did not print the rule ids I
grepped for and produced a false "rule is dead" reading.

## Concurrent agents in one git worktree collide

Two reviewers both mutate-and-restore in the same checkout, so each sees the
other's in-flight edits as spurious `git status` dirt and spurious lint errors
at line numbers that don't exist. Serialise mutation testing, or give each
reviewer its own worktree. Don't `git checkout --` a file you didn't dirty.
