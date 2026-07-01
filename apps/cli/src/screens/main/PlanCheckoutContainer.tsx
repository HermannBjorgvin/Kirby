import { useMemo } from 'react';
import { useInput } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { PlanCheckoutPane } from '../reviews/PlanCheckoutPane.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { useSidebar } from '../../context/SidebarContext.js';
import { useNavState, useNavActions } from '../../context/NavContext.js';
import { useAsyncOps } from '../../context/AsyncOpsContext.js';
import { usePlan } from '../../context/PlanContext.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import { handlePlanCheckoutInput } from './main-input.js';

interface PlanCheckoutContainerProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  selectedPr: PullRequestInfo | undefined;
  terminalFocused: boolean;
}

// Interactive checkout pane: review the per-PR plan as a checklist,
// prune items, edit notes, then forward the composed prompt to a Claude
// agent in the PR's worktree. Mounted by MainContent when
// paneMode === 'plan-checkout'.
export function PlanCheckoutContainer({
  pane,
  terminal,
  selectedPr,
  terminalFocused,
}: PlanCheckoutContainerProps) {
  const keybinds = useKeybindResolve();
  const sessions = useSessionActions();
  const sidebar = useSidebar();
  const navState = useNavState();
  const navActions = useNavActions();
  const nav = useMemo(
    () => ({ ...navState, ...navActions }),
    [navState, navActions]
  );
  const asyncOps = useAsyncOps();
  const plan = usePlan();

  const prId = selectedPr?.id;
  const items = prId != null ? plan.list(prId) : [];

  useInput(
    (input, key) => {
      handlePlanCheckoutInput(input, key, {
        pane,
        plan,
        selectedPr,
        terminal,
        asyncOps,
        sessions,
        sidebar,
        nav,
        keybinds,
      });
    },
    { isActive: !terminalFocused }
  );

  return (
    <PlanCheckoutPane
      items={items}
      selectedIndex={pane.planCheckoutIndex}
      paneCols={terminal.paneCols}
      annotatingPlanKey={pane.annotatingPlanKey}
      annotationBuffer={pane.annotationBuffer}
      target={pane.planCheckoutTarget}
    />
  );
}
