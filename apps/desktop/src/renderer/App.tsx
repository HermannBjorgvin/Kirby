import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { KirbyHostApi, RepoInfo } from '../host/contract.js';
import { Toaster } from './components/ui/sonner.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import { queryClient } from './lib/queries.js';
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
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    window.kirby
      .getRepo()
      .then(setRepo)
      .catch(() => setRepo(null))
      .finally(() => setChecked(true));
  }, []);

  const openRepo = useCallback((cwd: string) => {
    window.kirby
      .openRepo(cwd)
      .then((r) => {
        queryClient.clear();
        setRepo(r);
      })
      .catch((err: unknown) => toast.error(errorMessage(err)));
  }, []);

  if (!checked) {
    return (
      <main className="flex h-screen items-center justify-center bg-background">
        <p className="animate-pulse text-sm text-muted-foreground">
          Connecting to host…
        </p>
      </main>
    );
  }

  if (!repo) {
    return (
      <RepoOpen
        onOpened={(r) => {
          queryClient.clear();
          setRepo(r);
        }}
      />
    );
  }

  return (
    <Workspace
      key={repo.cwd}
      repo={repo}
      onSwitchRepo={() => setRepo(null)}
      onOpenRepo={openRepo}
    />
  );
}
