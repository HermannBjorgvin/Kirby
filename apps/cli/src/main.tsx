import { useEffect, useState } from 'react';
import { render, Box, useApp } from 'ink';
import type { VcsProvider } from '@kirby/vcs-core';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import { githubProvider } from '@kirby/vcs-github';
import { DeleteConfirmModal } from './components/DeleteConfirmModal.js';
import { ToastContainer } from './components/ToastContainer.js';
import { AsyncOpsIndicator } from './components/AsyncOpsIndicator.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { killAll } from './pty-registry.js';
import {
  applySessionBackend,
  probeTmuxAvailability,
} from './session-backend.js';
import { ConfigProvider, useConfig } from './context/ConfigContext.js';
import { KeybindProvider } from './context/KeybindContext.js';
import { NavProvider, useNavState } from './context/NavContext.js';
import { AsyncOpsProvider } from './context/AsyncOpsContext.js';
import { LayoutProvider, useLayout } from './context/LayoutContext.js';
import { ModalProvider } from './context/ModalContext.js';
import { useDeleteConfirmState } from './context/ModalContext.js';
import { SessionProvider } from './context/SessionContext.js';
import { SidebarProvider } from './context/SidebarContext.js';
import { ToastProvider } from './context/ToastContext.js';
import { MainTab } from './screens/main/MainTab.js';

// ── Provider registry ──────────────────────────────────────────────

const providers: VcsProvider[] = [azureDevOpsProvider, githubProvider];

// ── App ────────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
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
    applySessionBackend({ ...config, terminalBackend });
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
          exit={exit}
        />
      </Box>
      {deleteConfirm.confirmDelete && (
        <DeleteConfirmModal
          branch={deleteConfirm.confirmDelete.branch}
          reason={deleteConfirm.confirmDelete.reason}
          confirmInput={deleteConfirm.confirmInput}
        />
      )}
      <AsyncOpsIndicator />
      <ToastContainer />
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

process.on('exit', killAll);
process.on('SIGINT', () => {
  killAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  killAll();
  process.exit(0);
});

// Fire the tmux probe in the background — the Settings UI reads the
// cached result synchronously. We don't await: by the time a user
// opens settings the probe has long since resolved.
void probeTmuxAvailability();

render(
  <ConfigProvider providers={providers}>
    <KeybindProvider>
      <LayoutProvider>
        <NavProvider>
          <AsyncOpsProvider>
            <ModalProvider>
              <ToastProvider>
                <SessionProvider>
                  <SidebarProvider>
                    <App />
                  </SidebarProvider>
                </SessionProvider>
              </ToastProvider>
            </ModalProvider>
          </AsyncOpsProvider>
        </NavProvider>
      </LayoutProvider>
    </KeybindProvider>
  </ConfigProvider>
);
