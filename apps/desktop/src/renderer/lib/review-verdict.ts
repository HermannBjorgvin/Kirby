import type { ReviewDecision } from '@kirby/vcs-core/types';
import type { ReviewVerdict } from '../../host/contract.js';

/**
 * What the viewer's reviewer entry becomes for a cast verdict.
 *
 * The verdicts Kirby offers are finer-grained than the decisions a
 * provider records, so this is a fold, not a rename. GitHub folds the
 * whole negative side into a changes-requested review; a provider that
 * distinguishes them (Azure DevOps) keeps "waiting for author" apart
 * from an outright rejection.
 */
export function verdictDecision(
  verdict: ReviewVerdict,
  providerId: string | undefined
): ReviewDecision {
  if (verdict === 'approve' || verdict === 'approve-with-suggestions')
    return 'approved';
  if (providerId === 'github') return 'changes-requested';
  return verdict === 'wait-for-author' ? 'waiting-for-author' : 'rejected';
}
