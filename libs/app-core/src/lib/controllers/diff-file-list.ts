import { useMemo } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { partitionFiles, type DiffFile } from '@kirby/diff';
import { planItemKey } from '../plan/plan-types.js';
import { useConfig } from '../context/ConfigContext.js';
import { usePlan } from '../context/PlanContext.js';
import type { PaneModeValue } from '../hooks/usePaneReducer.js';
import type { DiffBundle } from '../hooks/useDiffBundle.js';

/**
 * Shell-agnostic view model for the diff file list: everything the
 * renderer needs to draw the list and every number the input handler
 * needs to scroll/select it. TUI/DOM layout and keypress wiring stay
 * in the shell-specific containers.
 */
export function useDiffFileListViewModel({
  pane,
  selectedPr,
  diffBundle,
}: {
  pane: PaneModeValue;
  selectedPr: PullRequestInfo | undefined;
  diffBundle: DiffBundle;
}) {
  const { config } = useConfig();
  const plan = usePlan();
  const treeMode = config.diffFileListTree === true;

  const prId = selectedPr?.id;
  // Set of `${kind}:${id}` keys for comments already in this PR's plan.
  // Recomputed on any plan change (plan.snapshot identity) and threaded
  // to the cards as booleans so their memoization stays stable.
  const inPlanKeys = useMemo(() => {
    const m = new Map<string, boolean>();
    if (prId != null) {
      for (const i of plan.list(prId)) {
        m.set(planItemKey(i.kind, i.id), !!i.annotation);
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plan.snapshot drives freshness
  }, [prId, plan.snapshot]);

  // In tree mode, sort files alphabetically by path so siblings group
  // under the same dir. Hoisted here so the ordering is shared with
  // the input handler — selection index must point at the same file
  // the renderer highlights.
  const orderedFiles = useMemo(
    () =>
      treeMode
        ? [...diffBundle.files].sort((a, b) =>
            a.filename.localeCompare(b.filename)
          )
        : diffBundle.files,
    [diffBundle.files, treeMode]
  );

  const { normal: normalFiles, skipped: skippedFiles } = useMemo(
    () => partitionFiles(orderedFiles),
    [orderedFiles]
  );
  const fileCount = pane.showSkipped
    ? normalFiles.length + skippedFiles.length
    : normalFiles.length;

  // j/k walks files first, then extends into the comment cards. The
  // unified list renders every thread as a card (buildDiffListItems
  // caps nothing), so selection extends over all of them.
  const generalThreads = diffBundle.remote.generalComments;
  const diffDisplayCount = fileCount + generalThreads.length;

  const displayFiles = useMemo(
    () => (pane.showSkipped ? [...normalFiles, ...skippedFiles] : normalFiles),
    [normalFiles, skippedFiles, pane.showSkipped]
  );

  // Selection breakdown: indices [0, fileCount) select a file; indices
  // [fileCount, diffDisplayCount) select a footer comment (offset by
  // -fileCount). selectedCommentIndex is undefined when a file is
  // highlighted so the list component knows to leave cards unselected.
  const selectedCommentIndex =
    pane.diffFileIndex >= fileCount
      ? pane.diffFileIndex - fileCount
      : undefined;

  return {
    treeMode,
    inPlanKeys,
    prId,
    orderedFiles,
    normalFiles,
    skippedFiles,
    fileCount,
    generalThreads,
    diffDisplayCount,
    displayFiles,
    selectedCommentIndex,
  };
}

export type DiffFileListViewModel = ReturnType<typeof useDiffFileListViewModel>;
export type { DiffFile };
