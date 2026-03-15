import tty from 'node:tty';

// Diagnostic: log stdin/TTY state before anything else (remove after CI debugging)
console.error(
  JSON.stringify({
    isTTY: process.stdin.isTTY,
    isatty0: tty.isatty(0),
    stdinCtor: process.stdin.constructor.name,
    TERM: process.env.TERM,
    CI: process.env.CI,
  })
);

import { useState } from 'react';
import { render, Text, Box, useApp } from 'ink';
import type { VcsProvider } from '@kirby/vcs-core';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import { githubProvider } from '@kirby/vcs-github';
import { TabBar } from './components/TabBar.js';
import { StatusBar } from './components/StatusBar.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { useTerminal } from './hooks/useTerminal.js';
import { killAll } from './pty-registry.js';
import { ConfigProvider, useConfig } from './context/ConfigContext.js';
import { AppStateProvider, useAppState } from './context/AppStateContext.js';
import {
  SessionProvider,
  useSessionContext,
} from './context/SessionContext.js';
import { ReviewProvider, useReviewContext } from './context/ReviewContext.js';
import { SessionsTab } from './screens/sessions/SessionsTab.js';
import { ReviewsTab } from './screens/reviews/ReviewsTab.js';

// ── Provider registry ──────────────────────────────────────────────

const providers: VcsProvider[] = [azureDevOpsProvider, githubProvider];

// ── App ────────────────────────────────────────────────────────────

function App({ forceSetup }: { forceSetup: boolean }) {
  const { exit } = useApp();
  const { config, provider, vcsConfigured } = useConfig();
  const { nav, terminal, termRows } = useAppState();
  const { selectedName, categorizedReviews } = useSessionContext();
  const { review, reviewSessionName } = useReviewContext();
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);

  const showOnboarding =
    !onboardingComplete &&
    !!config.vendor &&
    !!provider &&
    (!vcsConfigured || forceSetup);

  // ── Terminal hooks (must stay mounted across tab switches) ──────
  const terminalFocused = nav.focus === 'terminal';
  const escapeTerminal = () => nav.setFocus('sidebar');

  const sessionsTerminal = useTerminal(
    selectedName,
    terminal.paneCols,
    terminal.paneRows,
    reconnectKey,
    terminalFocused && nav.activeTab === 'sessions',
    escapeTerminal
  );
  const reviewsTerminal = useTerminal(
    nav.activeTab === 'reviews' ? reviewSessionName : null,
    terminal.paneCols,
    terminal.paneRows,
    review.reviewReconnectKey,
    terminalFocused && nav.activeTab === 'reviews',
    escapeTerminal
  );

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
          <TabBar
            activeTab={nav.activeTab}
            reviewCount={categorizedReviews.needsReview.length}
          />
          <StatusBar />
        </Box>
        <Text dimColor>{process.cwd()}</Text>
      </Box>
      <Box flexGrow={1}>
        {nav.activeTab === 'sessions' && (
          <SessionsTab
            reconnectKey={reconnectKey}
            setReconnectKey={setReconnectKey}
            terminalContent={sessionsTerminal.content}
            terminalFocused={terminalFocused}
            showOnboarding={showOnboarding}
            exit={exit}
          />
        )}
        {nav.activeTab === 'reviews' && vcsConfigured && (
          <ReviewsTab
            terminalFocused={terminalFocused}
            reviewsTerminalContent={reviewsTerminal.content}
            exit={exit}
          />
        )}
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

// Workaround: in PTY child processes (e.g. tui-test), process.stdin may not
// be marked as a TTY even though fd 0 is a valid TTY. Construct a proper
// tty.ReadStream so Ink's useInput/setRawMode works.
let stdin: NodeJS.ReadStream = process.stdin;
try {
  if (!process.stdin.isTTY && tty.isatty(0)) {
    stdin = new tty.ReadStream(0);
  }
} catch {
  /* fallback to process.stdin */
}

render(
  <ConfigProvider providers={providers}>
    <AppStateProvider>
      <SessionProvider>
        <ReviewProvider>
          <App forceSetup={forceSetup} />
        </ReviewProvider>
      </SessionProvider>
    </AppStateProvider>
  </ConfigProvider>,
  { stdin }
);
