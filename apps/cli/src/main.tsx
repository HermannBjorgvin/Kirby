import { useEffect, useState } from 'react';
import { render, Box, useApp } from 'ink';
import type { VcsProvider } from '@kirby/vcs-core';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import { githubProvider } from '@kirby/vcs-github';
import { DeleteConfirmModal } from './components/DeleteConfirmModal.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import {
  killAll,
  settlePendingRuns,
  applySessionBackend,
  probeTmuxAvailability,
  ConfigProvider,
  useConfig,
  KeybindProvider,
  NavProvider,
  useNavState,
  AsyncOpsProvider,
  PlanProvider,
  LayoutProvider,
  useLayout,
  ModalProvider,
  useDeleteConfirmState,
  SessionProvider,
  SidebarProvider,
  ToastProvider,
} from '@kirby/app-core';
import {
  repoTitle,
  setWindowTitle,
  restoreWindowTitle,
} from './utils/window-title.js';
import { MainTab } from './screens/main/MainTab.js';

// ── Provider registry ──────────────────────────────────────────────

const providers: VcsProvider[] = [azureDevOpsProvider, githubProvider];

// Upper bound on how long 'q' waits for in-flight git ops to finish
// before force-exiting. Real worktree/branch ops finish well under this;
// the cap guarantees quit still works if an op wedges.
const EXIT_GRACE_MS = 3_000;

// ── App ────────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  // Ink's exit() only unmounts the React tree — it does not stop child
  // processes. Active PTYs (running agents) keep node-pty handles open,
  // so the Node event loop never drains and the process hangs after
  // pressing 'q'. Tear down PTYs first, then force-exit. (#56)
  //
  // But process.exit(0) is synchronous and would abort an in-flight git
  // mutation (worktree create/delete, rebase) mid-write, leaving a
  // half-made worktree or dangling branch on disk. So first let any
  // pending run() op settle — bounded by a grace timeout so a wedged op
  // can't resurrect the #56 hang.
  const handleExit = () => {
    void (async () => {
      await Promise.race([
        settlePendingRuns(),
        new Promise((resolve) => setTimeout(resolve, EXIT_GRACE_MS)),
      ]);
      killAll();
      exit();
      process.exit(0);
    })();
  };
  const { config, provider, vcsConfigured } = useConfig();
  const nav = useNavState();
  const deleteConfirm = useDeleteConfirmState();
  const { termRows } = useLayout();
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  // Wire the active terminal backend factory into pty-registry whenever
  // the config selection changes. The Settings UI gates this to empty
  // registry, so existing sessions are never stranded on a stale factory.
  const terminalBackend = config.terminalBackend;
  useEffect(() => {
    applySessionBackend(config);
    // Only react to backend changes; other config edits don't need to
    // rebuild the factory. Capturing config in scope is fine — the
    // factory only reads `terminalBackend`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalBackend]);

  const showOnboarding =
    !onboardingComplete && !!config.vendor && !!provider && !vcsConfigured;

  const terminalFocused = nav.focus === 'terminal';

  if (showOnboarding) {
    return (
      <Box flexDirection="column" height={termRows}>
        <OnboardingWizard onComplete={() => setOnboardingComplete(true)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={termRows}>
      <Box flexGrow={1}>
        <MainTab
          terminalFocused={terminalFocused}
          showOnboarding={showOnboarding}
          exit={handleExit}
        />
      </Box>
      {deleteConfirm.confirmDelete && (
        <DeleteConfirmModal
          branch={deleteConfirm.confirmDelete.branch}
          reason={deleteConfirm.confirmDelete.reason}
          mode={deleteConfirm.confirmDelete.mode}
          confirmInput={deleteConfirm.confirmInput}
        />
      )}
    </Box>
  );
}

// ── Entry point ────────────────────────────────────────────────────

const args = process.argv.slice(2);

// ── Subcommand routing (no React/Ink needed) ─────────────────────
if (args[0] === 'util') {
  const { handleUtilCommand } = await import('./commands/util.js');
  await handleUtilCommand(args.slice(1));
  process.exit(0);
}

const targetDir = args.find((a) => !a.startsWith('--'));
if (targetDir) {
  process.chdir(targetDir);
}

// Name the tab after the repo, so a terminal full of Kirbys is legible.
// Skip the git lookup entirely when there's no TTY to title (CI, pipes).
if (process.stdout.isTTY) {
  setWindowTitle(repoTitle());
}

process.on('exit', () => {
  killAll();
  restoreWindowTitle();
});
process.on('SIGINT', () => {
  killAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  killAll();
  process.exit(0);
});

// Resolve the tmux probe before render so applySessionBackend's
// startup fallback (tmux requested but unavailable → PTY) sees a
// populated cache. Probe is memoized; ~ms cost on `tmux -V`.
await probeTmuxAvailability();

render(
  <ConfigProvider providers={providers}>
    <KeybindProvider>
      <LayoutProvider>
        <NavProvider>
          <AsyncOpsProvider>
            <PlanProvider>
              <ModalProvider>
                <ToastProvider>
                  <SessionProvider>
                    <SidebarProvider>
                      <App />
                    </SidebarProvider>
                  </SessionProvider>
                </ToastProvider>
              </ModalProvider>
            </PlanProvider>
          </AsyncOpsProvider>
        </NavProvider>
      </LayoutProvider>
    </KeybindProvider>
  </ConfigProvider>
);
