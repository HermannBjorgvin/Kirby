# 😸 Kirby

A desktop app and a terminal UI for running AI coding agents across git worktrees, with pull request status and code review built in.

Kirby started as a way to solve my own workflow. I spend my working hours in a large monorepo, usually with several features and reviews in flight at once, and I wanted one place to manage the worktrees and agent sessions that go with them and to help me automate PR reviews while remaining familiar with the source code. It's early and still moving fast, @minigod and I have been using it as our daily worktree manager and now I feel it is feature complete enough to share with others who might have a similar workflow.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/hero.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/media/hero-light.png">
  <img alt="Kirby Desktop reviewing a pull request: the sidebar lists worktrees and pull requests with their status, the review rail shows files and comments, and a reviewer's thread sits inline in the diff" src="docs/media/hero.png">
</picture>

## Installation

Two front ends over the same core — install either, or both.

```sh
npm install -g @hermannbjorgvin/kirby-desktop@beta   # desktop app
npm install -g @hermannbjorgvin/kirby                # terminal UI
```

Then run `kirby-desktop` or `kirby` from any project directory.

## Features

### A worktree and an agent per branch

![Creating a branch from the command palette, which opens a worktree and a tab, then launching an agent in it](docs/media/worktrees.gif)

- **Worktree-based sessions** - every branch gets its own git worktree and a long-lived agent session. Spin them up, switch between them, and tear them down without stashing or disturbing your main checkout. Built for monorepos where several features are in progress at the same time.
- **PR status next to every worktree** - the sidebar shows each branch's pull request state inline: open, draft, or merged, CI result, review status, and conflict count against the base. Most worktree tools stop at the branch name; Kirby tells you where the branch actually stands.
- **GitHub and Azure DevOps** - both supported today. Support for other providers can be added via pull request.
- **Branch sync** - detects merged branches, counts conflicts against the base, auto-deletes merged worktrees, and rebases onto the base with one key.

### Agent-drafted reviews

![Stepping through agent-written draft comments in severity order, posting one and skipping to the next](docs/media/review.gif)

Point an agent at a pull request and have it review the diff. It leaves inline draft comments anchored to the lines they're about, and you walk through them in severity order — edit, discard, skip, or post. You stay the author of record; the agent just does the first pass.

### Plan comments into a cart

![Queueing two review comments into a plan, annotating one with a note, previewing the composed prompt, and sending it to an agent](docs/media/plan.gif)

The other direction: on a PR you're resolving, add the review comments you want to address to a plan, like you're shopping on eBay. Annotate any of them with a note on how you want it handled, check out when you're happy, and the whole thing goes to an agent as one task — you can read the exact prompt before it's sent.

### Review in place

Browse a PR's files and diffs, read comment threads, reply, and resolve or reopen threads without leaving Kirby. The desktop renders whole-file diffs with folding, split and unified views, and word-level highlighting; comment images are fetched with your provider credentials.

### Customizable and agent agnostic

- **Pick your agent** - Claude, Codex, Gemini, Copilot, or OpenCode, configurable per project.
- **Customizable keybindings** - Normie and Vim presets out of the box, remappable from the Controls panel.
- **Light and dark** - the desktop follows your system theme, or pin one. (The screenshot at the top of this page is already showing you yours.)

> Kirby is early-stage software. It works well enough that we rely on it every day, but expect rough edges and breaking changes.

## The terminal UI

Everything above except the desktop-only chrome is in the TUI too — same core, same config, same worktrees. The sidebar lists your branches with their PR status and lets you start an agent session and worktree from any of them.

<img alt="Kirby's terminal UI, with the branch sidebar on the left and an agent session on the right" src="https://github.com/user-attachments/assets/db4b13b2-3b8d-4783-8c58-353cff0243a2" />

## Prerequisites

- git
- An agent CLI on your `PATH` — `claude`, `codex`, `copilot`, `gemini` or `opencode`
- For GitHub: the `gh` CLI, authenticated
- For Azure DevOps: a personal access token with repo and pull request access
- `tmux` (optional) — agent sessions then survive quitting and are reattached next launch
- On Linux, the desktop app compiles `node-pty` during install: `sudo apt install build-essential python3`

## Configuration

On first run in a new project, an onboarding wizard walks you through connecting your VCS provider. After that, open settings (`s` in the TUI, ⌘, / Ctrl+, on the desktop) to change the provider, AI agent, sync intervals, and auto-behaviors (auto-delete merged branches, auto-rebase). Auto-detect fills in project settings from the git remote.

Keybindings are remappable. Kirby ships with a Normie preset and a Vim preset; open the Controls panel to switch presets or rebind individual actions.

Everything lives in `~/.kirby/`.
