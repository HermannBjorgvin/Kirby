import { useEffect, useRef } from 'react';
import { activeTabRepo, useTabs } from './tabs.js';

/**
 * Keep the open repository pointing at whichever tab is in front of the
 * user.
 *
 * The tab strip outlives a repo switch, so the active tab can belong to
 * a repository that is not open — the user clicked it, cycled onto it,
 * or the tab beside it closed and handed it focus. The host holds one
 * repository at a time (`requireRepo`, the memoized repo root, the
 * session-ownership guard), so the way to show that tab's content again
 * is to open its repo: the sidebar and status bar then describe the
 * same repository the editor is showing, which is the only arrangement
 * where "which repo am I in?" has one answer.
 *
 * It reacts to a change of *active tab*, never to a change of
 * repository. Opening a repo from the picker while a foreign tab
 * happens to be active would otherwise bounce straight back to that
 * tab's repo, and a failed open would retry forever.
 */
export function useRepoFollowsTabs(
  repoCwd: string | null,
  openRepo: (cwd: string) => Promise<boolean>
): void {
  const tabs = useTabs();
  const target = activeTabRepo(tabs);
  const lastActiveId = useRef(tabs.activeId);

  useEffect(() => {
    const activeId = tabs.activeId;
    const moved = lastActiveId.current !== activeId;
    lastActiveId.current = activeId;
    if (!moved) return;
    // No repo open at all means the picker is on screen; the user asked
    // for it and the tabs do not get to override that.
    if (repoCwd === null || target === null || target === repoCwd) return;
    void openRepo(target);
  }, [tabs.activeId, target, repoCwd, openRepo]);
}
