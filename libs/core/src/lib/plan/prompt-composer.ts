import type { PlanItem } from './plan-types.js';

// ── Prompt composer ──────────────────────────────────────────────
//
// Turns a plan (list of comment snapshots) into the rich prompt that
// is forwarded to the agent. Pure — no I/O, no React — so it's
// trivially unit-testable against exact strings.
//
// Format:
//
//   Resolve these PR review comments:
//
//   ### 1. apps/cli/src/DiffViewer.tsx:42  (thread PRRT_kwHO)
//   @alice: This loop re-renders on every keystroke; memoize it.
//     ↳ @bob: agreed, useMemo would fix it
//   Your note: Wrap in useMemo keyed on annotatedLines.
//
// Local items carry a `[severity]` tag; remote items render the root
// author + threaded replies. The "Your note:" line appears only when
// the item is annotated.
//
// Every item names the identifier the provider knows it by — a review
// thread id for a remote comment, the draft's own id for a local one —
// because "fix comment 3" is a position in this prompt and nothing
// else. An agent that has to go back to the thread (to reply to it, or
// to check whether it has since been answered) needs the id the
// provider will accept, and there is no way to derive one from a file
// and a line.

const HEADER = 'Resolve these PR review comments:';

function locationLabel(item: PlanItem): string {
  const file = item.file ?? 'general';
  return item.line != null ? `${file}:${item.line}` : file;
}

/**
 * How the item is addressed outside this prompt. Remote items are a
 * provider thread; a local draft is a file the agent itself wrote, and
 * names the thread it answers when it was written as an answer.
 */
function identityLabel(item: PlanItem): string {
  if (item.kind === 'remote') return `(thread ${item.id})`;
  return item.threadId
    ? `(draft ${item.id} · thread ${item.threadId})`
    : `(draft ${item.id})`;
}

function renderItem(item: PlanItem, index: number): string {
  const lines: string[] = [];
  const n = index + 1;
  const id = identityLabel(item);

  if (item.kind === 'local') {
    lines.push(`### ${n}. ${locationLabel(item)}  [${item.severity}]  ${id}`);
    lines.push(item.body);
  } else {
    lines.push(`### ${n}. ${locationLabel(item)}  ${id}`);
    lines.push(`@${item.author}: ${item.body}`);
    for (const reply of item.replies) {
      lines.push(`  ↳ @${reply.author}: ${reply.body}`);
    }
  }

  if (item.annotation) {
    lines.push(`Your note: ${item.annotation}`);
  }

  return lines.join('\n');
}

/** Compose the agent prompt from a plan. */
export function composePlanPrompt(items: PlanItem[]): string {
  const blocks = items.map(renderItem);
  return [HEADER, '', blocks.join('\n\n')].join('\n');
}
