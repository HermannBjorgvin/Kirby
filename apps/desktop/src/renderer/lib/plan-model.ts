import { planItemKey, type PlanItem } from '@kirby/core/plan';
import type { CommentSeverity } from '../../host/contract.js';

/**
 * The decisions the plan ("add to cart") UI makes, separated from the
 * components that render them.
 *
 * A plan is a queue of review comments the user wants one agent to work
 * through in one go. The items are *value snapshots* taken at add-time
 * (see @kirby/core's plan-types) — resolving, editing or posting the
 * underlying comment afterwards leaves the queued copy alone, which is
 * why a row here reads from the snapshot and never from the live
 * thread.
 */

/** One row of the cart, as the pane renders it. */
export interface PlanRow {
  /** `${kind}:${id}` — stable identity for React keys and removal. */
  key: string;
  /** 1-based, and the same number `composePlanPrompt` gives the item. */
  index: number;
  kind: PlanItem['kind'];
  id: string;
  /** "file:line", "file", or "Conversation". */
  location: string;
  /** Remote items only: who wrote the comment. */
  author?: string;
  /** Local (agent draft) items only. */
  severity?: CommentSeverity;
  body: string;
  note?: string;
  /** Replies under the root comment, carried into the prompt. */
  replyCount: number;
}

/**
 * Where a queued comment lives, for the row's monospace label. A
 * comment with no file is a general PR comment; the review rail already
 * calls that place "Conversation", so the cart does too.
 */
export function planLocation(item: PlanItem): string {
  if (item.file == null) return 'Conversation';
  return item.line != null ? `${item.file}:${item.line}` : item.file;
}

/**
 * The cart's rows, in the order the items were added — which is also
 * the order `composePlanPrompt` numbers them, and therefore the order
 * the agent is asked to work through. Sorting here (by file, say) would
 * silently renumber the prompt against the list the user is reading.
 */
export function planRows(items: readonly PlanItem[]): PlanRow[] {
  return items.map((item, i) => ({
    key: planItemKey(item.kind, item.id),
    index: i + 1,
    kind: item.kind,
    id: item.id,
    location: planLocation(item),
    ...(item.kind === 'remote'
      ? { author: item.author, replyCount: item.replies.length }
      : { severity: item.severity, replyCount: 0 }),
    body: item.body,
    ...(item.annotation ? { note: item.annotation } : {}),
  }));
}

/** How the plan reads at a glance: "3 comments · 1 with a note". */
export function planSummary(items: readonly PlanItem[]): {
  count: number;
  noted: number;
} {
  return {
    count: items.length,
    noted: items.filter((i) => (i.annotation ?? '').trim().length > 0).length,
  };
}

/** Delivering the plan into a live agent, or starting a fresh one. */
export type CheckoutChoice = 'inject' | 'new-session';

export interface CheckoutModel {
  canSend: boolean;
  /** The delivery options to offer, most preferred first. */
  choices: CheckoutChoice[];
  primary: CheckoutChoice;
}

/**
 * What the checkout footer offers.
 *
 * With no agent running there is nothing to choose: sending starts one,
 * seeded with the plan. With one already running the choice is real and
 * asymmetric — injecting types the plan into the conversation it is
 * already having, while restarting throws that conversation away — so
 * injecting leads and restarting is the explicit second action.
 */
export function checkoutModel(opts: {
  count: number;
  agentRunning: boolean;
  sending: boolean;
}): CheckoutModel {
  const choices: CheckoutChoice[] = opts.agentRunning
    ? ['inject', 'new-session']
    : ['new-session'];
  return {
    canSend: opts.count > 0 && !opts.sending,
    choices,
    primary: choices[0]!,
  };
}
