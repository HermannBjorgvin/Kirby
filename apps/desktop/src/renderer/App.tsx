import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import type { KirbyHostApi, RepoInfo } from '../host/contract.js';
import { Toaster } from './components/ui/sonner.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import { keys, queryClient, resetRepoScopedCache } from './lib/data/query-keys.js';
import { useRepoGate } from './lib/data/queries.js';
import { errorMessage } from './lib/utils.js';
import { RepoOpen } from './screens/RepoOpen.js';
import { Workspace } from './screens/Workspace.js';

declare global {
  interface Window {
    kirby: KirbyHostApi;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Gate />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Gate() {
  const qc = useQueryClient();
  const { data: repo, isPending } = useRepoGate();

  /** Adopt a repository the host has already switched to. */
  const adoptRepo = useCallback(
    (r: RepoInfo) => {
      resetRepoScopedCache(qc);
      qc.setQueryData(keys.repo, r);
    },
    [qc]
  );

  const openRepo = useCallback(
    (cwd: string) => {
      window.kirby
        .openRepo(cwd)
        .then(adoptRepo)
        .catch((err: unknown) => toast.error(errorMessage(err)));
    },
    [adoptRepo]
  );

  const pickRepoFolder = useCallback(() => {
    window.kirby
      .selectRepoDirectory()
      .then((dir) => {
        if (dir) openRepo(dir);
      })
      .catch((err: unknown) => toast.error(errorMessage(err)));
  }, [openRepo]);

  if (isPending) {
    return (
      <main className="flex h-screen items-center justify-center bg-background">
        <p className="animate-pulse text-sm text-muted-foreground">
          Connecting to host…
        </p>
      </main>
    );
  }

  if (!repo) {
    return <RepoOpen onOpened={adoptRepo} />;
  }

  return (
    <Workspace
      key={repo.cwd}
      repo={repo}
      onSwitchRepo={() => qc.setQueryData(keys.repo, null)}
      onOpenRepo={openRepo}
      onPickRepoFolder={pickRepoFolder}
    />
  );
}
