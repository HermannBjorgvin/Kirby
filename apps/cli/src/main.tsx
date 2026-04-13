import { useEffect, useState } from 'react';
import { render, Box, useApp } from 'ink';
import type { VcsProvider } from '@kirby/vcs-core';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import { githubProvider } from '@kirby/vcs-github';
import { StatusBar } from './components/StatusBar.js';
import { DeleteConfirmModal } from './components/DeleteConfirmModal.js';
import { ToastContainer } from './components/ToastContainer.js';
import { AsyncOpsIndicator } from './components/AsyncOpsIndicator.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { killAll } from './pty-registry.js';
import { ConfigProvider, useConfig } from './context/ConfigContext.js';
import { KeybindProvider } from './context/KeybindContext.js';
import { AppStateProvider, useAppState } from './context/AppStateContext.js';
import { LayoutProvider, useLayout } from './context/LayoutContext.js';
import { SessionProvider } from './context/SessionContext.js';
import { SidebarProvider } from './context/SidebarContext.js';
import { ToastProvider, useToastActions } from './context/ToastContext.js';
import { MainTab } from './screens/main/MainTab.js';

// ── Provider registry ──────────────────────────────────────────────

const providers: VcsProvider[] = [azureDevOpsProvider, githubProvider];

// ── App ────────────────────────────────────────────────────────────

function App({ forceSetup }: { forceSetup: boolean }) {
  const { exit } = useApp();
  const { config, provider, vcsConfigured } = useConfig();
  const { nav, deleteConfirm } = useAppState();
  const { termRows } = useLayout();
  const { flash } = useToastActions();
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  // Dev-only visual test harness for the toast stack. Gated on
  // `KIRBY_TOAST_DEMO=1` so it has zero overhead in normal use. Every
  // 4s fires a burst of 1–6 toasts with a random stagger — short bursts
  // show one or two toasts at a time, long bursts blow past the 5-cap
  // so you can watch the oldest toast get evicted.
  useEffect(() => {
    if (process.env.KIRBY_TOAST_DEMO !== '1') return;
    const variants = ['info', 'success', 'warning', 'error'] as const;
    const words =
      'the quick brown fox jumps over the lazy dog in a terminal window today for visual testing purposes'.split(
        ' '
      );
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const id = setInterval(() => {
      const burst = 1 + Math.floor(Math.random() * 6);
      for (let i = 0; i < burst; i++) {
        const delay = i * (100 + Math.floor(Math.random() * 200));
        timeouts.push(
          setTimeout(() => {
            const variant =
              variants[Math.floor(Math.random() * variants.length)]!;
            const length = 2 + Math.floor(Math.random() * 12);
            const message = Array.from(
              { length },
              () => words[Math.floor(Math.random() * words.length)]!
            ).join(' ');
            flash(message, variant);
          }, delay)
        );
      }
    }, 4000);
    return () => {
      clearInterval(id);
      for (const t of timeouts) clearTimeout(t);
    };
  }, [flash]);

  const showOnboarding =
    !onboardingComplete &&
    !!config.vendor &&
    !!provider &&
    (!vcsConfigured || forceSetup);

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
      <Box flexShrink={0} paddingX={1}>
        <StatusBar />
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

const forceSetup = args.includes('--setup');
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
        <AppStateProvider>
          <ToastProvider>
            <SessionProvider>
              <SidebarProvider>
                <App forceSetup={forceSetup} />
              </SidebarProvider>
            </SessionProvider>
          </ToastProvider>
        </AppStateProvider>
      </LayoutProvider>
    </KeybindProvider>
  </ConfigProvider>
);
