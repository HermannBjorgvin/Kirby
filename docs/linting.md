# Linting

`eslint.config.mjs` is the single flat config; the three e2e projects
extend it. Beyond `typescript-eslint` strict + `react-hooks` v7
(recommended, at **error** — that is the React team's compiler-powered
analysis, and it passes clean), it enforces four groups.

**Write file globs unanchored, or a whole project silently opts out.**
`apps/cli-e2e`, `apps/desktop-e2e` and `apps/cli-wterm-host` build
their configs by spreading the root one, and ESLint **re-bases a
relative glob onto the config that spreads it** — so a block scoped
`files: ['apps/**/*.ts']` becomes `apps/cli-e2e/apps/**/*.ts` there and
matches nothing. Every size budget and the entire type-aware block
therefore did not apply to ~8k lines of Playwright suite, including
`no-floating-promises`, in the code most made of promises. The globs
are `**/*.{ts,tsx}` and `**/src/**/*.{ts,tsx}` now, which survive the
re-basing. Blocks meant for one project (the Ink rules, the renderer
import rules) stay anchored on purpose — there, matching nothing
elsewhere is the point. Check a new block with
`cd apps/desktop-e2e && npx eslint --print-config <file>` rather than
by reading the glob.

**Warnings fail the build — check exit codes, not output.** The
inferred lint target is `eslint .`, which exits 0 with warnings
present, so for a long time every budget above was advisory and a
`nx run-many -t lint` exit code proved nothing. `nx.json`
`targetDefaults.lint` now overrides the command to
`eslint . --max-warnings 0` (the inferred per-project `cwd` survives
the override, which is what makes it correct), and `lint-staged` runs
`eslint --fix --max-warnings 0`. Verified by mutation: a
complexity-21 function added to a `desktop-e2e` file — a spot that
previously escaped both the glob and the exit code — fails the target
with exit 1.

**Size and shape budgets — warnings, and a ratchet.** `max-lines` 300
(blank lines and comments excluded), `complexity` 12, `max-depth` 4 at
error. These are set where they bound what gets _added_ rather than
where they would be comfortable: a file grows past 300 lines and a
function past 12 branches one plausible edit at a time, and nobody
reviews that as growth.

**Every list is empty, and 12 was reached by refactoring rather than
by exempting.** All 47 functions that stood between 18 and 12 came
down — 31 to reach 13, 16 more to reach 12 — and not one of them
needed a carve-out. The metric turned out to be a good detector here:
in every case it was pointing at a function doing two jobs, a lookup
table written as an if-chain, or a component holding a section that
wanted to be its own component. Nothing has yet been found that is
irreducibly branchy, so **reach for the refactor before reaching for
an exception**, and if you do add one, say what makes that function
different from these 47.

The next notch is a real decision rather than a cleanup, and the
numbers are measured: of 1676 functions, 1257 score under 5, and the
count over a candidate ceiling is 15 at 11, 46 at 10, 100 at 8 and 153
at 7. Below 11 it starts reporting ordinary components with a handful
of conditional renders, where the split stops paying for itself. Of
341 files, 3 exceed 300 (all three the deliberately exempted ones), 18
exceed 250 and 41 exceed 200. Two files carry a 900-line ceiling
instead
(`libs/vcs/*/provider.ts`, `keybindings/registry.ts`): they are a REST
surface and an action catalog, and splitting either spreads one lookup
table across files. Specs are exempt from `max-lines` only.

**Type-aware rules** (`projectService`, ~19s workspace-wide).
`no-floating-promises` is why the block exists: Kirby is almost
entirely async git, PTY and provider calls, and a dropped promise there
is a silent no-op plus an unhandled rejection. `ignoreVoid` keeps
deliberate fire-and-forget expressible — `void doThing()` puts the
intent on the page. Also `no-misused-promises`, `await-thenable`, and
`switch-exhaustiveness-check` (a `default` counts), which catches the
"added a union member, missed one of its switches" half-landing.
Joined later, each measured at or near zero first so they only bound
what gets added: `no-unsafe-call` and `no-unsafe-argument` (the last
step of an `any` escaping a `JSON.parse` and being invoked),
`consistent-type-exports`, `prefer-promise-reject-errors`,
`return-await` (`in-try-catch`: returning a promise from inside `try`
escapes the `catch` written to handle it) and `no-deprecated`.

**React Compiler blind spots — `react-hooks/todo` is on for a reason.**
react-hooks v7 is React Compiler analysis wearing a lint plugin, and
when the compiler cannot lower a function it **abandons it**: every
other rule in the plugin goes quiet for that file, reporting nothing no
matter what the code does. `recommended` leaves the one rule that says
so (`todo`) off, which is how two render-phase ref writes sat unflagged
under `react-hooks/refs` set to `error` — copy either line into a fresh
file and it errors instantly. `try/finally` is the common trigger (also
a conditional inside `try/catch`, and some member-expression
reorders). Six files are affected and are **listed by name in
`eslint.config.mjs`** with the rule turned off, because the code is
right as written — `finally` is how you release a loading flag — and a
list is more honest than a refactor. The rule stays on everywhere else,
so a _new_ file entering that state gets reported instead of joining
the list quietly. `react-doctor` is not compiler-powered and is the way
to check what those six actually contain.

Note the same shape of gap in `react/no-array-index-key`: it only sees
an index arriving as a `.map()` parameter, so a hand-rolled loop
counter used as a key reads as an ordinary variable and passes. A clean
run means "no obvious ones".

**Ink rules** (`tools/eslint-plugin-ink.mjs`, TUI only). Ink enforces
its layout contract at _runtime_ by throwing, so a bad component
type-checks, builds, ships, and dies the first time that branch
renders. `no-raw-text` and `no-layout-inside-text` are clean today and
exist to stay that way; `no-bare-process-exit` is off for `main.tsx`
and `commands/**`, which legitimately own exiting. The rules resolve
components through their import, so a renamed `Text` still counts and a
non-Ink `Box` does not.

These are local because the obvious dependency still does not cover
them. `eslint-plugin-react-doctor` ships 22 `ink-*` rules; at **0.9.12
two of them work** (`ink-no-raw-text`, `ink-no-layout-inside-text`),
which is a change from when this was last measured and they reported
nothing at all. Against one file violating three rules, scoped so both
plugins' globs apply, ours reports 3 and react-doctor 2 — it misses
`ink-no-bare-process-exit` — and our messages name the runtime failure
rather than the rule. Keep the local plugin; re-measure rather than
assuming either direction.

The rest of that plugin remains a poor fit: of 593 reports from
`recommended` (581 rules) across this codebase, **65% is two rules
premised on React Compiler**, which we do not run — 206
`react-compiler-no-manual-memoization` and 179
`jsx-no-new-function-as-prop` — and 83% once `jsx-max-depth` and
`only-export-components` are added. The residue is worth reading
periodically, though: it is not compiler-powered, so it sees into the
blind spots below, and it found the two live render-phase ref writes
plus a derived-`useState` there.

**Test hygiene.** `@vitest/eslint-plugin` on `*.spec.*`;
`eslint-plugin-playwright` covers the e2e suites from their own
configs. `vitest/no-focused-tests` is the one that matters — a stray
`.only` leaves CI green while running one test, which is worse than a
red build because nothing signals it.

Everything except `max-depth`, `no-param-reassign` and the Ink and
vitest rules is a **warning** — which, now that the target passes
`--max-warnings 0`, is a distinction in reporting rather than in
consequence. The app predated the budgets, so the point was a downward
ratchet rather than a wall — and the ratchet has arrived. Current
standing, across all 17 projects (`nx run-many -t lint --all`): **0
errors, 0 warnings**. Measure with `--all`: the three e2e suites lint
under their own Playwright configs and are invisible otherwise, which
is how a smaller number once read as clean.

Zero is now the baseline, so a warning is a regression and there is no
backlog to hide in. **A `PostToolUse` hook holds it there**:
`.claude/settings.json` runs `tools/lint-hook.mjs` after every
Write/Edit, and a file left with any problem blocks the edit with
ESLint's own output. It lints from the directory whose config owns the
file, not from the repo root — `apps/cli-e2e`, `apps/desktop-e2e` and
`apps/cli-wterm-host` each carry their own flat config, and ESLint 9
loads config from the working directory, so a root-cwd run reports "No
issues found" on an e2e file that genuinely violates its own Playwright
rules. It stays out of the way otherwise: a non-JS path, a file already
deleted, one outside the repo, or ESLint itself failing to run all pass
the edit through, because none of those is the edit's fault. Two of the categories that got it there were not
cosmetic, and are worth knowing before reintroducing the pattern:

- **`no-floating-promises` was a crash.** Nothing awaits
  `asyncOps.run` and nothing installs an `unhandledRejection` handler,
  so a git call rejecting inside one ended the process. `run` reports
  failures through `setOperationErrorHandler` — `SessionProvider`
  points it at the toast rail — and never rejects. Do not restore a
  version that rejects, and do not silence this rule with `void` where
  the rejection has nowhere to go.
- **`playwright/no-wait-for-timeout`** is off for
  `apps/cli-e2e/src/setup/waits.ts` alone. Every fixed wait in the TUI
  suite goes through `settleFor(page, ms, reason)`, whose reason
  becomes a test step. Most waits there are load-bearing — proving a
  toast never fires, outlasting the resize debounce, or letting Ink's
  `useInput` see a filter its closure captured a render ago — so
  reach for an auto-waiting assertion first and `settleFor` only for
  those cases.

**Inline suppressions are down to six, each with a `--` rationale**:
four `no-control-regex` (a terminal escape sequence starts with the
byte the rule flags), one `exhaustive-deps` in `useReviewComments` (a
revision counter is the change signal for a file on disk, and there is
no snapshot to derive from), and one `react-hooks/incompatible-library`
in `VirtualDiffList` (the virtualizer hands back methods, and this
build does not run React Compiler anyway). Anything new should clear
the same bar: say why the rule cannot apply here, not that it is
inconvenient.

Two rule-level notes worth keeping. `react-hooks` v7 is
compiler-powered, so a suppression can **hide analysis of the whole
hook** — removing the render-phase ref writes in `useMergedBranches`
surfaced a synchronous `setState` nobody had seen. And an inline
`eslint-disable` naming a plugin rule is a **hard error in the
pre-commit hook**, which runs eslint without the Playwright plugin
registered; scope those in the project's `eslint.config.mjs` instead.

**`apps/cli` specs are type-checked** via `apps/cli/tsconfig.spec.json`
— it did not exist, so 26 spec files and `src/test-utils/**` were
excluded from every `tsc` invocation. Adding it surfaced two dozen real
errors, including `vi.fn<[], boolean>()` (vitest v1 syntax) typing
mocks as `never`. When adding a project, check its `tsconfig.json`
references the spec project as well as the app one.
