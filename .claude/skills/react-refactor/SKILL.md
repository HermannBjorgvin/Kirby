---
name: react-refactor
description: >
  Refactor React TypeScript codebases to follow modern 2025–2026 best practices.
  Use this skill whenever the user asks to refactor, clean up, improve, modernize,
  or review a React codebase or component. Also trigger when the user mentions
  React anti-patterns, code smells, useEffect cleanup, state management improvements,
  component architecture, prop drilling fixes, performance optimization, or
  converting class components to modern hooks. Trigger even for partial requests
  like "clean up this component" or "this feels messy" when React/TSX code is involved.
---

# React Codebase Refactoring Skill

This skill guides you through analyzing and refactoring React TypeScript code into clean, modern patterns aligned with the React 19 / React Compiler era.

## Before you begin

Read the reference file for the area you're working on:

| Situation            | Reference to read                                                          |
| -------------------- | -------------------------------------------------------------------------- |
| Any refactoring task | `references/patterns.md` — full pattern catalog with before/after examples |
| Broad codebase audit | `references/patterns.md` § "Triage Checklist"                              |

Always read `references/patterns.md` before writing any refactored code.

## Refactoring workflow

### 1. Audit — Identify smells

Scan the target code (file, feature, or codebase) and categorize every issue found using the smell catalog in `references/patterns.md`. Produce a brief triage report for the user before changing anything:

```
## Refactor audit — [file or feature name]

### Critical (change these first)
- [ ] Derived state stored in useState + useEffect (lines 42–48)
- [ ] Component defined inside another component (line 112)

### High (architectural improvements)
- [ ] Server data stored in Zustand instead of TanStack Query
- [ ] Prop drilling through 4 levels — use composition

### Medium (cleanup)
- [ ] Nested ternary chain in JSX (line 88)
- [ ] 3 related useState calls → useReducer candidate

### Low (polish)
- [ ] Missing discriminated union for variant props
- [ ] Barrel file re-exports hurting HMR
```

Present this to the user and confirm priorities before proceeding. The user may want to tackle everything, or just the criticals.

### 2. Plan — Group changes into safe steps

Never refactor everything in one giant commit. Group related changes into discrete, testable steps:

1. **Extract** — Pull out hooks, sub-components, or utilities without changing behavior
2. **Replace** — Swap anti-patterns for correct patterns (e.g., remove derived-state useEffect)
3. **Restructure** — Move files, change architecture (feature folders, remove barrel files)
4. **Upgrade** — Adopt new APIs (React 19 hooks, form actions, ref-as-prop)

Each step should leave the code in a working state. If the user has tests, confirm they pass between steps.

### 3. Execute — Apply patterns from the reference

For each change, follow the exact before/after patterns in `references/patterns.md`. Key principles:

- **Preserve behavior first.** Every refactor must be behavior-preserving unless the user explicitly wants behavior changes.
- **One concern per commit.** Don't mix "replace useEffect" with "restructure folders."
- **Add types as you go.** If you're touching a component, fix its TypeScript types too.
- **Remove, don't just add.** Refactoring should reduce code volume. If your refactor makes the file longer, reconsider.

### 4. Verify — Check your work

After each refactoring step:

- Confirm the component tree still renders the same UI
- Confirm event handlers still fire correctly
- Confirm no `any` types were introduced
- Confirm no new useEffect was added (unless synchronizing with an external system)
- If tests exist, run them
- If the project has a linter (`eslint`, `biome`), run it

## Priority order for smells

When auditing, prioritize fixes in this order (highest impact first):

1. **Components defined inside other components** — causes remounts, destroys state, worst perf bug
2. **Derived state in useState + useEffect** — most common React anti-pattern, causes extra renders and bugs
3. **Server data in client state stores** — should be in TanStack Query, eliminates entire categories of bugs
4. **Prop drilling through 4+ levels** — use composition (children) or Context
5. **God components (300+ lines)** — extract sub-components and custom hooks
6. **Multiple boolean flags for state** — replace with union/enum or useReducer
7. **Manual useMemo/useCallback everywhere** — remove unless profiling shows need
8. **Nested ternary chains** — early returns or extract sub-components
9. **Missing TypeScript strictness** — add discriminated unions, remove `any`
10. **Barrel file re-exports** — replace with direct imports

## What NOT to do during refactoring

- Don't introduce new dependencies unless the user agrees (e.g., don't add Zustand if they didn't ask for it)
- Don't restructure folders unless that's part of the ask — file moves are noisy in diffs
- Don't convert working class components to hooks unless explicitly requested
- Don't add React.memo/useMemo/useCallback "just in case" — the React Compiler handles this
- Don't create a `useMount` hook — it doesn't fit React's model
- Don't create hooks that never call other hooks — make those plain functions
- Don't abstract components after seeing the pattern only once — wait for 2–3 occurrences (AHA principle)

## Communicating refactoring changes

When presenting refactored code, always:

1. Show what you removed and why (cite the specific smell)
2. Show the replacement pattern
3. Explain the benefit in one sentence (fewer re-renders, impossible states prevented, simpler mental model)
4. If the change is non-obvious, include a brief before/after diff
