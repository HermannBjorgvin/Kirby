import type { PullRequestInfo } from '@kirby/vcs-core';
import {
  CONVENTIONAL_DECORATIONS,
  CONVENTIONAL_LABELS,
} from '@kirby/review-comments';
import type { LaunchRequest } from './launch-session.js';

/**
 * The launch request for an AI review session of a PR — shared by every
 * shell (TUI, desktop) so the agent always gets the same task prompt
 * and the same `kirby util add-comment` guidance.
 *
 * Resumes an existing review conversation in the worktree when the
 * agent supports it, otherwise seeds a fresh session with the prompt.
 */
export function buildReviewLaunchRequest(
  pr: Pick<
    PullRequestInfo,
    'id' | 'title' | 'sourceBranch' | 'targetBranch' | 'createdByDisplayName'
  >,
  additionalInstruction?: string
): LaunchRequest {
  // Reusable how-to guidance (installed as a system prompt for agents
  // that support it, e.g. Claude; folded into the prompt otherwise).
  const systemGuidance =
    `To add review comments, use this command:\n` +
    `  kirby util add-comment --pr=${pr.id} --file=<path> --lineStart=<n> --lineEnd=<n> --severity=<critical|major|minor|nit> --body="<comment>"\n\n` +
    `Rules:\n` +
    `- File paths are relative to the repo root\n` +
    `- lineStart/lineEnd are 1-based line numbers in the NEW version of the file\n` +
    `- Use --side=LEFT only when commenting on removed/deleted lines\n` +
    `- Severity: critical (blocks merge), major (should fix), minor (nice to fix), nit (style/preference)\n` +
    `- Add --thread=<id> to record which existing review thread a comment ` +
    `is about. It is still posted as a new comment at --file/--lineStart, ` +
    `not as a reply in that thread — the id is there so the reader can see ` +
    `which conversation you had in mind. Thread ids come from the review ` +
    `data you are given (a plan prompt names each one as "(thread <id>)"); ` +
    `they are the provider's own ids and are the only way to say which ` +
    `conversation you mean.\n` +
    `- Comments appear live in the reviewer's diff viewer\n\n` +
    `Write each --body as a Conventional Comment (conventionalcomments.org):\n` +
    `  <label> [decorations]: <subject>\n` +
    `\n` +
    `  <discussion>\n\n` +
    `- Labels: ${CONVENTIONAL_LABELS.join(', ')}\n` +
    `- Decorations, in parentheses and comma-separated: ` +
    `${CONVENTIONAL_DECORATIONS.join(', ')}\n` +
    `- The subject is one line saying the thing; the discussion below the ` +
    `blank line is where the reasoning, the evidence and any code go\n` +
    `- Write the header yourself when you have a better one than the ` +
    `severity implies (e.g. "question (blocking):"); a body without one ` +
    `is given the header its severity maps to. The louder of the two ` +
    `wins, so do not open a comment with a label word unless you mean ` +
    `it as the label — "Note: ..." on a critical finding is read as the ` +
    `sentence it is, not as a downgrade\n` +
    `- Do not sign the comment or say it came from an AI — that is added ` +
    `when it is posted`;

  let prompt =
    `Review PR #${pr.id} ("${pr.title || pr.sourceBranch}") ` +
    `merging ${pr.sourceBranch} → ${pr.targetBranch} ` +
    `by ${pr.createdByDisplayName || 'unknown'}.\n\n` +
    `Review all changed files thoroughly. Add comments for any issues found.`;

  const extra = additionalInstruction?.trim();
  if (extra) {
    prompt +=
      ` ADDITIONAL USER INSTRUCTION (overrides previous where applicable): ` +
      extra;
  }

  return { intent: 'continue-or-seed', prompt, systemGuidance };
}
