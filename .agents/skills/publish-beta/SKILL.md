---
name: publish-beta
description: Publish a beta of the two npm packages (@hermannbjorgvin/kirby and @hermannbjorgvin/kirby-desktop): bump both versions to the same -beta.N, commit, run the nx publish targets, verify the latest tag moved. Use only when the user asks to publish or release.
disable-model-invocation: true
---

# Publishing to npm

Two packages ship from this repo, both beta-only and published manually from a local machine — there is no CI workflow for either:

| Package                                | Source         | Users install                                        |
| -------------------------------------- | -------------- | ---------------------------------------------------- |
| `@hermannbjorgvin/kirby` (TUI)         | `apps/cli`     | `npm install -g @hermannbjorgvin/kirby@beta`         |
| `@hermannbjorgvin/kirby-desktop` (GUI) | `apps/desktop` | `npm install -g @hermannbjorgvin/kirby-desktop@beta` |

**Users need both, and packaging cannot fix that — it is documented
instead.** A review agent records what it finds by running `kirby util
add-comment`, which ships only in the CLI package, so agent-drafted
reviews do not work on a desktop-only install. Both READMEs say so.
Two things were measured before settling for documentation, so nobody
re-derives them: npm does **not** put a dependency's `bin` on the
user's PATH for a global install (only the named package's bins are
linked — the dependency's is not installed anywhere in the prefix), so
having the desktop depend on the CLI achieves nothing; and two global
packages declaring the same bin name **hard-error** on the second
install ("Remove the existing file and try again"), so giving the
desktop its own `kirby` bin would make installing both impossible in
either order. The remaining option, if this ever becomes worth it, is
for the desktop to ship a private `kirby` beside its own binary and
prepend that directory to the PATH of the sessions it spawns — the
agent's environment, never the user's. `apps/cli/src/commands/util.ts`
is 110 lines whose only import is `@kirby/review-comments`, which the
desktop already bundles.

**They share one version number.** Both are front-ends over the same core and release together, so a user can compare the two numbers and know what they have. `scripts/shared-version.mjs` enforces it: each package's publish-prep calls `assertVersionsMatch()` and refuses to prepare a mismatched pair.

## One-time setup

- `npm login` on your machine. `npm whoami` must resolve to an account that owns the `@hermannbjorgvin` scope.

## How to publish a beta version

1. Bump the version in **both** `apps/cli/package.json` and `apps/desktop/package.json` to the same value. Every version must end in `-beta.N`:

   - Patch: `0.0.1-beta.2` or `0.0.2-beta.1`
   - Minor: `0.1.0-beta.1`
   - Major: `1.0.0-beta.1`

2. Commit the bump:

   ```bash
   git commit apps/cli/package.json apps/desktop/package.json -m "chore: bump kirby to 1.0.0-beta.5"
   ```

3. Publish:

   ```bash
   npx nx run cli:publish
   npx nx run desktop:publish
   ```

   `cli:publish` runs `build` → `prepare-publish.mjs` → `npm publish --tag beta apps/cli/dist` → `dist-tag-latest.mjs`; `desktop:publish` runs `build` → `prepare-install.mjs` → `npm publish --tag beta apps/desktop/dist` → `dist-tag-latest.mjs`.

   **Each release carries both `beta` and `latest`.** A single publish can set only one tag, so the publish sets `beta` — the install path both READMEs document, live the moment the version exists — and `scripts/dist-tag-latest.mjs` moves `latest` onto the same version immediately after. Without that second call npm leaves `latest` behind, and a prerelease version is never resolved by a plain `npm install -g <pkg>`, so anyone omitting `@beta` would silently get an older release. The script takes the version from `assertVersionsMatch()` rather than an argument, so it cannot tag a version that was never published.

## Desktop packaging notes

`prepare-install.mjs` writes `dist/package.json` (scoped name, `publishConfig.access: public` — a scoped package publishes restricted otherwise), copies the launcher, `apps/desktop/README.md` and the repo `LICENSE` into `dist/` (npm only picks up a README from the pack root), marks the launcher executable, and packs a tarball for `install-global`.

The published package carries two runtime deps: `electron` (the binary the launcher spawns, ~190 MB on install) and `node-pty`. node-pty is N-API based, so its binary loads under Electron with no `@electron/rebuild` step on the user's machine — but it ships prebuilds for macOS and Windows only, so **Linux installs compile it** and need `build-essential` + `python3`. Windows users are pointed at WSL, where the Linux path applies.

## Build details

`npx nx build cli` bundles all workspace libs (`@kirby/*`) and npm deps into a single `apps/cli/dist/main.js` with a `#!/usr/bin/env node` shebang. Only `node-pty` is kept external (it's a native module).

The build copies the source `apps/cli/package.json` into `dist/` via its `assets` config — that copy is fine for `install-global` but carries workspace `@kirby/*` deps that don't exist on the npm registry. So `apps/cli/scripts/prepare-publish.mjs` rewrites `dist/package.json` just before publishing, keeping only the fields needed for npm (name, version, bin, etc.) and `node-pty` as the sole runtime dependency.
