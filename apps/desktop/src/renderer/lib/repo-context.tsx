import { createContext, useContext, type ReactNode } from 'react';
import type { RepoInfo } from '../../host/contract.js';

interface RepoContextValue {
  repo: RepoInfo;
  /** Return to the repo picker. */
  switchRepo: () => void;
  /** Open another repository in place. The workspace follows it — the
   *  sidebar, status bar and every repo-scoped query re-point — while
   *  the tab strip keeps the tabs of whatever was open before. */
  openRepo: (cwd: string) => void;
}

const RepoContext = createContext<RepoContextValue | null>(null);

export function RepoProvider({
  value,
  children,
}: {
  value: RepoContextValue;
  children: ReactNode;
}) {
  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error('useRepo must be used inside RepoProvider');
  return ctx;
}
