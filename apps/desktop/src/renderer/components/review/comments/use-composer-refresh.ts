import { useCallback, useState } from 'react';
import { useRefreshThreads } from '../../../lib/data/mutations.js';
import { useRepo } from '../../../lib/repo-context.js';
import {
  composerRefreshNotice,
  type ComposerNotice,
} from '../../../lib/diff/thread-model.js';

/**
 * Opening a composer asks the provider what it missed.
 *
 * `useThreads` serves a cache up to half a minute old, so the reader
 * who starts typing a reply may be answering a question somebody has
 * already answered. Opening the box therefore kicks off a refetch of
 * that pull request's threads and reports on it: the composer itself
 * never waits — it is open and focused before the round trip starts —
 * and the cards repaint from the query when the answer lands.
 *
 * `count` is whatever the caller counts as "how much conversation
 * there is" (a thread's comments, a PR's threads). It is snapshotted
 * at open-time so the notice can say what arrived *since*, rather than
 * how much there is.
 *
 * Pass `null` when the caller cannot yet say — a query that has not
 * answered has no count, and taking zero for one turns the first
 * response into "12 new comments arrived". With no baseline the
 * composer still reports the check it is running; it just never claims
 * to know what changed.
 */
export interface ComposerRefresh {
  /** Call when the composer opens. */
  begin: () => void;
  /** Call when it closes, by cancel or by a successful send. */
  end: () => void;
  /** Line to show above the input, or null when there is nothing to say. */
  notice: ComposerNotice | null;
}

export function useComposerRefresh(
  prId: number,
  count: number | null
): ComposerRefresh {
  const { repo } = useRepo();
  const refresh = useRefreshThreads(repo.cwd);
  const [baseline, setBaseline] = useState<number | null>(null);
  const { mutate } = refresh;

  const begin = useCallback(() => {
    setBaseline(count);
    mutate(prId);
  }, [count, mutate, prId]);

  const end = useCallback(() => setBaseline(null), []);

  return {
    begin,
    end,
    notice: composerRefreshNotice({
      checking: refresh.isPending,
      baseline,
      current: count ?? 0,
    }),
  };
}
