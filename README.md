# 😸 Kirby (working title, name of my cat)

A desktop app and a terminal UI for running AI coding agents across git worktrees, with pull request status and code review built in.

Kirby started as a way to solve my own workflow. I spend my working hours in a large monorepo, usually with several features and reviews in flight at once, and I wanted one place to manage the worktrees and agent sessions that go with them and to help me automate reviewing pull requests while remaining familiar with the source code.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/hero.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/media/hero-light.png">
  <img alt="Kirby Desktop reviewing a pull request: the sidebar lists worktrees and pull requests with their status, the review rail shows files and comments, and a reviewer's thread sits inline in the diff" src="docs/media/hero.png">
</picture>

## Installation

Two front ends over the same core. Install both:

```sh
npm install -g @hermannbjorgvin/kirby-desktop   # desktop app
npm install -g @hermannbjorgvin/kirby                # terminal UI, and the `kirby` cli utils
```

Then run `kirby-desktop` or `kirby` from any project directory.

Both, because review agents record their comments by running `kirby util add-comment` — so agent-drafted reviews need `kirby` on your `PATH` even if you only open the desktop app. Everything else works without it.

### Customizable and agent agnostic

- **Pick your agent** - Claude, Codex, Gemini, Copilot, or OpenCode, configurable per project.
- **Customizable keybindings** - Normie and Vim presets out of the box, remappable from the Controls panel.

> Kirby is early-stage software. It works well enough that we rely on it every day, but expect rough edges and breaking changes.

## Features

### A worktree and an agent per branch

![Creating a branch from the command palette, which opens a worktree and a tab, then launching an agent in it](docs/media/worktrees.gif)

- **Worktree-based sessions** - every branch gets its own git worktree and a long-lived agent session, so several features can be in flight without stashing or disturbing your main checkout.
- **PR status next to every worktree** - open, draft or merged, CI result, review status and conflict count, inline in the sidebar. One circle carries both axes: red when a build failed or someone rejected, green and filled only when CI passed _and_ everyone approved.
- **GitHub and Azure DevOps** - see [Version control providers](#version-control-providers).
- **Branch sync** - detects merged branches, counts conflicts against the base, auto-deletes merged worktrees, and a shortcut to auto rebase to lastest main/master

### Agent-drafted reviews

![Stepping through agent-written draft comments in severity order, posting one and skipping to the next](docs/media/review.gif)

Point an agent at a pull request and have it review the diff. It leaves inline draft comments anchored to the lines they're about, and you walk through them in severity order — edit, discard, skip, or post. You stay the author of record; the agent just does the first pass.

This is the feature that needs the CLI installed alongside the desktop app.

### Plan comments into a cart

![Queueing two review comments into a plan, annotating one with a note, previewing the composed prompt, and sending it to an agent](docs/media/plan.gif)

The other direction: on a PR you're resolving, add the comments you want to address to a plan, like a shopping cart. Annotate any with a note on how you want it handled, then check out — the whole thing goes to an agent as one task, and you can read the exact prompt first.

### Babysit a pull request

![Right-clicking a pull request with a failing build and choosing Babysit, the row's badge changing to update pending, then an agent starting in the branch's worktree with the CI failure and the open review thread as its prompt](docs/media/babysit.gif)

Right-click a pull request and choose **Babysit**. Kirby watches its CI, unresolved review threads and conflicts against the target branch, and once the news has settled (ten minutes of quiet, thirty at most) and the agent is idle, it types one update into the agent's session: the verdict, the conflicts, and each new thread named by its id. No agent on the branch? One is started in the worktree with the update as its opening prompt. The row's badge says what the babysitter is doing and why an update is being held.

### Review in place

![A pull request's overview with its description and approve buttons, then the diff in split and unified views, replying to a reviewer's thread and resolving it](docs/media/review-in-place.gif)

The pull request's own overview and verdict buttons, then the diff: browse files, read threads, reply, resolve and reopen, split or unified — without leaving Kirby. Whole-file diffs with folding and word-level highlighting are desktop-only.

### Light and dark themes

The most important feature of any software

![The review workspace wiped between the dark and light themes](docs/media/theme.gif)

## The terminal UI

Most of the work goes into the desktop app now, but `kirby` is the whole thing without a window — same core, same config, same worktrees, shared with the desktop. Run `kirby` in your repo root to bring up the TUI.

![The Kirby TUI: the sidebar with CI and review state, a pull request diff with reviewers' threads inline, queueing a comment with a note, and sending the plan to an agent](docs/media/tui.gif)

## Prerequisites

- `git`
- `node` and `npm`
- An agent CLI on your `PATH` — `claude`, `codex`, `copilot`, `gemini` or `opencode`
- `kirby` on your `PATH` for agent-drafted reviews, including when you use the desktop app
- For GitHub: the `gh` CLI, authenticated
- For Azure DevOps: a personal access token with repo and pull request access
- `tmux` (optional) — installed, it is the default backend: agent sessions survive quitting and are reattached next launch. Settings → Terminal Backend to pin PTY instead.
- On Linux, the desktop app compiles `node-pty` during install: `build-essential` and `python3` required.

## Version control providers

| Provider                  | Auth                   | Tested                                       |
| ------------------------- | ---------------------- | -------------------------------------------- |
| GitHub                    | authenticated `gh` CLI | unit, offline e2e, live integration          |
| Azure DevOps              | personal access token  | unit + recorded API responses; no live tests |
| GitLab, Bitbucket, etc... | not supported          | —                                            |

An Azure DevOps regression won't be caught by CI, so bug reports help. Providers sit behind one interface (`libs/vcs/`) — more can be added, PRs welcome.

## Configuration

On first run in a new project, an onboarding wizard walks you through connecting your VCS provider. After that, open settings (`s` in the TUI, ⌘, / Ctrl+, on the desktop) to change the provider, AI agent, sync intervals, and auto-behaviors (auto-delete merged branches, auto-rebase). Auto-detect fills in project settings from the git remote.

Keybindings are remappable. Kirby ships with a Normie preset and a Vim preset; open the Controls panel to switch presets or rebind individual actions.

Everything lives in `~/.kirby/`.
