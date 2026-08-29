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
//   ### 1. apps/cli/src/DiffViewer.tsx:42  [major]
//   @alice: This loop re-renders on every keystroke; memoize it.
//     ↳ @bob: agreed, useMemo would fix it
//   Your note: Wrap in useMemo keyed on annotatedLines.
//
// Local items carry a `[severity]` tag; remote items render the root
// author + threaded replies. The "Your note:" line appears only when
// the item is annotated.

const HEADER = 'Resolve these PR review comments:';

function locationLabel(item: PlanItem): string {
  const file = item.file ?? 'general';
  return item.line != null ? `${file}:${item.line}` : file;
}

function renderItem(item: PlanItem, index: number): string {
  const lines: string[] = [];
  const n = index + 1;

  if (item.kind === 'local') {
    lines.push(`### ${n}. ${locationLabel(item)}  [${item.severity}]`);
    lines.push(item.body);
  } else {
    lines.push(`### ${n}. ${locationLabel(item)}`);
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
