import { useState } from 'react';
import { render, Text, Box, useApp } from 'ink';
import type { VcsProvider } from '@kirby/vcs-core';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import { githubProvider } from '@kirby/vcs-github';
import { StatusBar } from './components/StatusBar.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { killAll } from './pty-registry.js';
import { ConfigProvider, useConfig } from './context/ConfigContext.js';
import { KeybindProvider } from './context/KeybindContext.js';
import { AppStateProvider, useAppState } from './context/AppStateContext.js';
import { LayoutProvider, useLayout } from './context/LayoutContext.js';
import { SessionProvider } from './context/SessionContext.js';
import { SidebarProvider } from './context/SidebarContext.js';
import { MainTab } from './screens/main/MainTab.js';

// ── Provider registry ──────────────────────────────────────────────

const providers: VcsProvider[] = [azureDevOpsProvider, githubProvider];

// ── App ────────────────────────────────────────────────────────────

function App({ forceSetup }: { forceSetup: boolean }) {
  const { exit } = useApp();
  const { config, provider, vcsConfigured } = useConfig();
  const { nav } = useAppState();
  const { termRows } = useLayout();
  const [onboardingComplete, setOnboardingComplete] = useState(false);

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
      <Box paddingX={1} justifyContent="space-between" marginBottom={1}>
        <Box gap={2}>
          <Text bold>😸 Kirby</Text>
          <StatusBar />
        </Box>
        <Text dimColor>{process.cwd()}</Text>
      </Box>
      <Box flexGrow={1}>
        <MainTab
          terminalFocused={terminalFocused}
          showOnboarding={showOnboarding}
          exit={exit}
        />
      </Box>
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
          <SessionProvider>
            <SidebarProvider>
              <App forceSetup={forceSetup} />
            </SidebarProvider>
          </SessionProvider>
        </AppStateProvider>
      </LayoutProvider>
    </KeybindProvider>
  </ConfigProvider>
);
