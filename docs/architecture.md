# Project structure

```
apps/cli/                        — Ink TUI application (ESM, React 19) — thin render layer over @kirby/app-core
  src/main.tsx                   — Entry point, root component
  src/input-handlers.ts          — Settings/controls input handlers (keybind-driven state transitions)
  src/components/                — Shared components (SidebarLayout, TerminalView, TabBar, StatusBar, etc.)
  src/models/                    — Pure view-models behind those components (sidebar-layout, comment-card-model, pr-badge-model)
  src/screens/main/              — Main tab (sidebar, diff, branch picker, confirm dialogs)
  src/screens/reviews/           — Reviews tab (DiffFileList, DiffViewer, ReviewDetailPane)
  src/hooks/                     — Ink-coupled hooks (useTerminal, useScrollWheel, useRawStdinForward, useDiffListScrollSync)
apps/desktop/                    — Electron GUI shell over @kirby/app-core (kirby-desktop)
  src/main/                      — Electron main: window chrome + security posture (window.ts), native app menu (menu.ts), KIRBY_QA_STEPS hook
  src/preload/preload.ts         — Typed contextBridge → window.kirby
  src/host/contract.ts           — Single source of truth for the bridge API + IPC channel names (incl. MenuCommand, ContextMenuItem, DesktopPrefs)
  src/host/services/             — Main-process services (sidebar w/ remote PR cache, sessions w/ scrollback buffer, settings, desktop-prefs…)
  src/renderer/                  — Vite + React 19 + Tailwind v4 web app (no Node access)
    styles.css                   — Design tokens (VS Code-style light/dark palette, type scale) — components use tokens only
    components/ui/               — shadcn-style primitives (radix-ui + cva + lucide): button, dialog, command, select…
    components/                  — TitleBar, StatusBar, CommandPalette, sidebar/, editor/ (tabs), settings/, terminal/
    components/review/           — the review workspace shell: PrWorkspace, PrHeader, ReviewRail(+Sections), ContentPane, OverviewPane, PlanPane/PlanControls
    components/review/comments/  — reviewer threads: ThreadCard, CommentsList, CommentMarkdown, ConversationPanel…
    components/review/diff/      — the viewer: DiffPane, VirtualDiffList, diff-rows, FileTree, SnippetView…
    components/review/drafts/    — the agent's drafts + walkthrough: DraftCard, DraftEditor, ReviewStepper…
    lib/                         — grouped by subsystem, not one flat folder (see below)
    lib/data/                    — queries.ts (TanStack Query over window.kirby), mutations.ts, query-keys.ts
    lib/diff/                    — diff-model.ts (fold, split pairing), diff-virtual.ts, word-diff.ts, highlight.ts, thread-model.ts
    lib/tabs/                    — tabs-model.ts (pure reducer: preview/pinned, `sync-items`), tabs.tsx, use-close-tabs.tsx
    lib/plan/                    — plan-model.ts (rows, numbering), plan.ts, use-plan-checkout.ts
    lib/review/                  — review-model.ts (what the workspace shows), review-verdict.ts, severity.ts, use-comment-navigator.ts
    lib/sidebar/                 — sidebar-model.ts, sidebar-row-menu.ts, attention.ts
    lib/*.ts                     — what belongs to no subsystem: utils, theme, terminal-grid, content-key, settings-*
    screens/                     — RepoOpen (repo picker) and Workspace (shell + shortcuts)
  scripts/dev.mjs                — Dev orchestrator: esbuild watch + vite HMR + electron restart
  scripts/qa-shots.mjs           — Headless visual QA: drives the built app under xvfb and writes PNGs
apps/cli-wterm-host/             — HTTP + WS host that bridges Kirby PTY to browser
  src/main.ts                    — Server: /spawn, /kill, WS /pty, ring buffer
  src/protocol.ts                — Shared SpawnRequest + ControlMessage types
  src/public/index.html
  src/public/client.ts           — Browser: @wterm/dom + auto-reconnect WS
  build.mjs                      — Single esbuild script (Node server + browser client)
apps/cli-e2e/                    — E2E tests (@playwright/test)
  src/fixtures/kirby.ts          — Per-test: temp repo, POST /spawn, page, term helpers
  src/setup/                     — git-repo.ts, sidebar.ts, constants.ts, github.ts
  src/*.test.ts                  — Test files (one per feature area)
  playwright.config.ts           — chromium-only, workers: 1, webServer: nx serve cli-wterm-host
libs/core/                       — Shell-agnostic core. No React, Ink or Electron (lint-enforced)
  src/lib/session/               — Session launch + plan checkout flows
  src/lib/plan/                  — Plan store (external store) + prompt composition
  src/plan.ts                    — Browser-safe entry (`@kirby/core/plan`) for the renderer
  src/lib/utils/                 — Pure helpers (sidebar-items, session-sort, diff-fetcher, virtual-viewport…)
  src/lib/settings/              — Settings field model (fields, presets, resolveValue)
  src/lib/sync/                  — Remote sync passes (sweepMergedBranches, conflict counts)
  src/lib/agents/                — Agent registry
  src/lib/activity.ts            — Agent activity registry; pty-registry.ts — PTY session lifecycle
  src/lib/session-backend.ts     — Terminal backend factory wiring (PTY/tmux)
  src/lib/keybindings/           — Customizable keybinding system
    registry.ts                  — Action catalog, presets (Normie/Vim), ActionId type
    resolver.ts                  — matchesKey, resolveAction, findConflict, descriptorFromKeypress
    hints.ts                     — Human-readable key display strings
    controls-data.ts             — Controls panel data logic (buildControlsRows, getBindingRows)
  src/lib/input/                 — KeyPress type (shell-agnostic ink-Key shape) + text-input handling
libs/app-core/                   — The React layer over @kirby/core, shared by both shells
  src/lib/context/               — React state contexts (Config, Session, Sidebar, Nav, Modal, Toast, Layout…)
  src/lib/hooks/                 — Shell-agnostic hooks (useSessionManager, useDiffData, useRemoteComments…)
  src/lib/controllers/           — Headless screen controllers (diff file list / viewer view-models)
  src/lib/plan/use-plan-store.ts — useSyncExternalStore binding for core's plan store
libs/worktree-manager/           — Git worktree and branch operations
  src/lib/worktree.ts            — Worktree CRUD, branch utils, conflict checks
libs/terminal/                   — Terminal emulator (renderer) + SessionBackend interface
  src/lib/terminal-emulator.ts   — @xterm/headless wrapper with ANSI rendering
  src/lib/session-backend.ts     — SessionSpec, SessionBackend, SessionBackendFactory contract
libs/terminal-pty/               — Direct PTY backend (node-pty)
  src/lib/pty-session.ts         — node-pty wrapper (PtySession)
  src/lib/pty-backend.ts         — createPtyBackendFactory()
libs/terminal-tmux/              — Tmux backend (optional system tmux ≥ 2.0)
  src/lib/tmux-cli.ts            — execFileSync wrappers for tmux subcommands
  src/lib/tmux-backend.ts        — createTmuxBackendFactory({ sessionPrefix })
  src/lib/sanitize-tmux-session-name.ts — pure name sanitizer ('.',':' → '-', length cap)
  src/lib/is-tmux-available.ts   — version probe + platform-aware install hint
```
