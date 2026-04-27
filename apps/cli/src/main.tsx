import { useState } from 'react';
import { render, Box, useApp } from 'ink';
import type { VcsProvider } from '@kirby/vcs-core';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import { githubProvider } from '@kirby/vcs-github';
import { DeleteConfirmModal } from './components/DeleteConfirmModal.js';
import { ToastContainer } from './components/ToastContainer.js';
import { AsyncOpsIndicator } from './components/AsyncOpsIndicator.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { killAll } from './pty-registry.js';
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
          mode={deleteConfirm.confirmDelete.mode}
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
