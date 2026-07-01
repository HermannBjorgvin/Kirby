# 😸 Kirby

A terminal UI for running AI coding agents across git worktrees, with pull request status and code review built in.

Kirby started as a way to solve my own workflow. I spend my working hours in a large monorepo, usually with several features and reviews in flight at once, and I wanted one place to manage the worktrees and agent sessions that go with them and to help me automate PR reviews while remaining familiar with the source code. It's early and still moving fast, @minigod and I have been using it as our daily worktree manager and now I feel it is feature complete enough to share with others who might have a similar workflow.

## Installation

```sh
npm install -g @hermannbjorgvin/kirby
```

Then run `kirby` from any project directory.

## Features

### Worktree management

- **Worktree-based sessions** - every branch gets its own git worktree and a long-lived agent session. Spin them up, switch between them, and tear them down without stashing or disturbing your main checkout. Built for monorepos where several features are in progress at the same time.
- **PR status next to every worktree** - the sidebar shows each branch's pull request state inline: open, draft, or merged, CI result, review status, and conflict count against the base. Most worktree tools stop at the branch name; Kirby tells you where the branch actually stands.
- **GitHub and Azure DevOps** - both supported today. Support for other providers can be added via pull request.
- **Branch sync** - detects merged branches, counts conflicts against the base, auto-deletes merged worktrees, and rebases onto the base with one key.

### Review automations - draft reviews and draft plans

- **Agent-drafted reviews** - point an agent at a pull request and have it review the diff. It leaves inline draft comments that show up right in the diff viewer, and you pick which ones to actually post and which to drop. You stay the author of record; the agent just does the first pass.
- **Plan comments into a cart** - the other direction: on a PR you're resolving, select the review comments you want to address, optionally annotate each with a note on how you want it handled, and add them to a draft plan like you're shopping on eBay. Then when you are happy you can go to checkout and send the plan to a new session and the agent gets to work.
- **Review in the terminal** - browse a PR's files and diffs, read comment threads, reply, and resolve or reopen threads without leaving the TUI.

### Customizable and Agent agnostic

- **Pick your agent** - Claude, Codex, Gemini, Copilot, or OpenCode, configurable per project.
- **Customizable keybindings** - Normie and Vim presets out of the box, remappable from the Controls panel.

> Kirby is early-stage software. It works well enough that we rely on it every day, but expect rough edges and breaking changes.

## Prerequisites

- git
- For GitHub: the `gh` CLI, authenticated
- For Azure DevOps: a personal access token with repo and pull request access

## Configuration

On first run in a new project, an onboarding wizard walks you through connecting your VCS provider. After that, press the settings key (`s` by default) to change the provider, AI agent, sync intervals, and auto-behaviors (auto-delete merged branches, auto-rebase). Auto-detect fills in project settings from the git remote.

Keybindings are remappable. Kirby ships with a Normie preset and a Vim preset; open the Controls panel to switch presets or rebind individual actions.

## Screenshot

The sidebar lists your branches with their PR status and lets you start an agent session and worktree from any of them.

<img alt="image" src="https://github.com/user-attachments/assets/db4b13b2-3b8d-4783-8c58-353cff0243a2" />
