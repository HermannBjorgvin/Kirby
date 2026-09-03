import type { BuildStatusState, PullRequestInfo } from '@kirby/vcs-core';
import type { BabysitReport, BabysitThread } from './babysit-model.js';

// ── Babysit update prompt ────────────────────────────────────────
//
// The message typed into the agent's session when a babysat pull
// request has news. Same conventions as the plan prompt: every thread
// is numbered and carries the provider's own id, so the agent can
// reply to or resolve the conversation it fixed, and the file:line it
// was left on.

type PromptPr = Pick<
  PullRequestInfo,
  'id' | 'title' | 'sourceBranch' | 'targetBranch'
>;

function ciLine(
  status: BuildStatusState | undefined,
  changed: boolean
): string {
  const now = changed ? ' (changed since you were last told)' : '';
  switch (status) {
    case 'failed':
      return `CI: failed${now}. Find out why and fix it.`;
    case 'succeeded':
      return `CI: passed${now}.`;
    case 'pending':
      return 'CI: running.';
    case 'none':
    case undefined:
      return 'CI: no checks reported.';
    default:
      return `CI: ${String(status)}.`;
  }
}

function conflictLine(report: BabysitReport, targetBranch: string): string {
  if (report.conflictCount === 0) {
    return `Conflicts: none against the latest ${targetBranch}.`;
  }
  const files =
    report.conflictCount === 1 ? 'file conflicts' : 'files conflict';
  return (
    `Conflicts: ${report.conflictCount} ${files} with the latest ` +
    `origin/${targetBranch}. Merge or rebase onto it and resolve them.`
  );
}

function threadBlock(thread: BabysitThread, index: number): string {
  const location =
    thread.line != null
      ? `${thread.file ?? 'general'}:${thread.line}`
      : thread.file ?? 'general';
  const [root, ...replies] = thread.comments;
  const lines = [`### ${index + 1}. ${location}  (thread ${thread.id})`];
  if (root) lines.push(`@${root.author}: ${root.body}`);
  for (const reply of replies) {
    lines.push(`  ↳ @${reply.author}: ${reply.body}`);
  }
  return lines.join('\n');
}

/** Compose the update typed into the agent's session. */
export function composeBabysitPrompt(
  pr: PromptPr,
  report: BabysitReport
): string {
  const parts: string[] = [
    `Status update for PR #${pr.id} ("${pr.title || pr.sourceBranch}", ` +
      `${pr.sourceBranch} → ${pr.targetBranch}):`,
    '',
    ciLine(report.buildStatus, report.ciChanged),
    conflictLine(report, pr.targetBranch),
  ];
  if (report.newThreads.length > 0) {
    parts.push(
      '',
      'Unresolved review comments you have not been told about:',
      '',
      ...report.newThreads.map(threadBlock)
    );
  }
  parts.push(
    '',
    'Address whatever needs addressing, push your changes, and reply to ' +
      'or resolve the threads you handled.'
  );
  return parts.join('\n');
}
