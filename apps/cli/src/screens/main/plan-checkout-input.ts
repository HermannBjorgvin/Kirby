import type { Key } from 'ink';
import { hasSession } from '../../pty-registry.js';
import { branchToSessionName } from '@kirby/worktree-manager';
import { handlePlanAnnotateInput } from '../../utils/plan-annotate-mode.js';
import { checkoutPlan } from '../../session/checkout-plan.js';
import { composePlanPrompt } from '../../plan/prompt-composer.js';
import { planItemKey } from '../../plan/plan-types.js';
import type { PlanCheckoutHandlerCtx } from './input-types.js';

// Interactive checkout pane input.
//
// Three modes, checked in order:
//   1. Annotation composer (annotatingPlanKey set) — edit a note.
//   2. Target choice (planCheckoutTarget set) — inject vs new-session,
//      shown only when an agent is already running in the worktree.
//   3. Checklist navigation — move/toggle-include/annotate/send/back.

export function handlePlanCheckoutInput(
  input: string,
  key: Key,
  ctx: PlanCheckoutHandlerCtx
): void {
  const { pane, plan, selectedPr } = ctx;
  const prId = selectedPr?.id;

  // ── 1. Annotation composer ──
  if (handlePlanAnnotateInput(input, key, { pane, plan, prId })) {
    return;
  }

  const items = prId != null ? plan.list(prId) : [];

  // ── 2. Inject-vs-new-session choice (State A) ──
  if (pane.planCheckoutTarget) {
    const action = ctx.keybinds.resolve(input, key, 'plan-checkout');
    if (action === 'plan-checkout.back') {
      pane.setPlanCheckoutTarget(null);
      return;
    }
    if (
      action === 'plan-checkout.navigate-up' ||
      action === 'plan-checkout.navigate-down'
    ) {
      pane.setPlanCheckoutTarget(
        pane.planCheckoutTarget === 'inject' ? 'new-session' : 'inject'
      );
      return;
    }
    if (action === 'plan-checkout.send') {
      runCheckout(ctx, pane.planCheckoutTarget);
      return;
    }
    return;
  }

  // ── 3. Checklist navigation ──
  const action = ctx.keybinds.resolve(input, key, 'plan-checkout');

  if (action === 'plan-checkout.back') {
    pane.setPaneMode(pane.priorPaneMode);
    return;
  }

  if (action === 'plan-checkout.navigate-down') {
    pane.setPlanCheckoutIndex((i) => Math.min(i + 1, items.length - 1));
    return;
  }
  if (action === 'plan-checkout.navigate-up') {
    pane.setPlanCheckoutIndex((i) => Math.max(i - 1, 0));
    return;
  }

  const selected = items[pane.planCheckoutIndex];

  // Toggle-include here means "drop from the plan" — the plan IS the
  // cart, so excluding an item removes it. Keeps the top-right
  // indicator truthful.
  if (action === 'plan-checkout.toggle-include' && selected && prId != null) {
    plan.remove(prId, selected.kind, selected.id);
    const remaining = plan.count(prId);
    if (remaining === 0) {
      // Nothing left — bail back to where we came from.
      pane.setPaneMode(pane.priorPaneMode);
      return;
    }
    pane.setPlanCheckoutIndex((i) => Math.min(i, remaining - 1));
    return;
  }

  if (action === 'plan-checkout.annotate' && selected) {
    pane.setAnnotatingPlanKey(planItemKey(selected.kind, selected.id));
    pane.setAnnotationBuffer(selected.annotation ?? '');
    return;
  }

  if (action === 'plan-checkout.send') {
    if (!selectedPr || prId == null || items.length === 0) {
      ctx.sessions.flashStatus('Plan is empty');
      return;
    }
    const name = branchToSessionName(selectedPr.sourceBranch);
    if (hasSession(name)) {
      // An agent is running — ask how to deliver. Default to inject
      // (non-destructive).
      pane.setPlanCheckoutTarget('inject');
      return;
    }
    // No running agent — spawn straight away (states B/C).
    runCheckout(ctx, 'new-session');
    return;
  }
}

function runCheckout(
  ctx: PlanCheckoutHandlerCtx,
  mode: 'inject' | 'new-session'
): void {
  const { pane, plan, selectedPr } = ctx;
  if (!selectedPr) return;
  const prId = selectedPr.id;
  const items = plan.list(prId);
  if (items.length === 0) {
    ctx.sessions.flashStatus('Plan is empty');
    return;
  }
  const prompt = composePlanPrompt(items);

  ctx.asyncOps.run('start-session', async () => {
    const result = await checkoutPlan({
      pr: selectedPr,
      prompt,
      paneCols: ctx.terminal.paneCols,
      paneRows: ctx.terminal.paneRows,
      mode,
      config: ctx.config.config,
      flashStatus: ctx.sessions.flashStatus,
    });
    if (result === 'failed') {
      // Leave the plan intact so the user can retry.
      pane.setPlanCheckoutTarget(null);
      return;
    }

    plan.clear(prId);
    await ctx.sessions.refreshSessions();
    const name = branchToSessionName(selectedPr.sourceBranch);
    ctx.sidebar.selectByKey(`session:${name}`);
    ctx.sessions.flashStatus(
      result === 'injected' ? 'Plan sent to agent' : 'Agent started with plan'
    );
    pane.setPlanCheckoutTarget(null);
    pane.setPaneMode('terminal');
    ctx.nav.setFocus('terminal');
    ctx.pane.setReconnectKey((k) => k + 1);
  });
}
