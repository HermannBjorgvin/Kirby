import type { BuildStatusState, PullRequestInfo } from '@kirby/vcs-core';
import type { BabysitReport, BabysitThread } from './babysit-model.js';

// ── Babysit update prompt ────────────────────────────────────────
//
// The message typed into the agent's session when a babysat pull
// request has news. Same conventions as the plan prompt: every thread
// is numbered and carries the provider's own id, so the agent can
// answer the conversation it fixed, and the file:line it was left on.

type PromptPr = Pick<
  PullRequestInfo,
  'id' | 'title' | 'sourceBranch' | 'targetBranch'
>;

function verdictWord(status: BuildStatusState | undefined): string {
  switch (status) {
    case 'failed':
      return 'failed';
    case 'succeeded':
      return 'passed';
    case 'pending':
      return 'running';
    default:
      return 'no checks reported';
  }
}

function ciLine(report: BabysitReport): string {
  const { buildStatus, lastToldBuildStatus, ciChanged } = report;
  const changed = ciChanged ? ' (new verdict since you were last told)' : '';
  switch (buildStatus) {
    case 'failed':
      return `CI: failed${changed}. Find out why and fix it.`;
    case 'succeeded':
      return `CI: passed${changed}.`;
    case 'pending':
      return lastToldBuildStatus === 'failed'
        ? 'CI: running; the last verdict you were told was failed.'
        : 'CI: running.';
    default:
      return `CI: ${verdictWord(buildStatus)}.`;
  }
}

function conflictLine(report: BabysitReport, targetBranch: string): string {
  const { conflictCount } = report;
  if (conflictCount === null) {
    return (
      `Conflicts: could not be checked this time (fetching origin/` +
      `${targetBranch} and the branch failed); check for yourself.`
    );
  }
  if (conflictCount === 0) {
    return `Conflicts: none against the latest origin/${targetBranch}.`;
  }
  const files = conflictCount === 1 ? 'file conflicts' : 'files conflict';
  return (
    `Conflicts: ${conflictCount} ${files} with the latest ` +
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
    ciLine(report),
    conflictLine(report, pr.targetBranch),
  ];
  if (report.newThreads.length > 0) {
    parts.push(
      '',
      'Unresolved review threads that are new or have new comments since ' +
        'you were last told:',
      '',
      ...report.newThreads.map(threadBlock)
    );
  }
  parts.push(
    '',
    'Address whatever needs addressing and push your changes. Each thread ' +
      'above is named by the id its provider uses, so you can answer the ' +
      'ones you handled.'
  );
  return parts.join('\n');
}
