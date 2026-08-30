import { describe, expect, it } from 'vitest';
import { verdictDecision } from './review-verdict.js';

/**
 * The optimistic patch `useSubmitVerdict` writes into the cached
 * sidebar goes through this fold, so a wrong answer here paints the
 * wrong reviewer dot on the row until the next remote refresh lands.
 */
describe('verdictDecision', () => {
  it('reads both approving verdicts as an approval', () => {
    expect(verdictDecision('approve', 'github')).toBe('approved');
    expect(verdictDecision('approve-with-suggestions', 'github')).toBe(
      'approved'
    );
    expect(verdictDecision('approve', 'azure-devops')).toBe('approved');
  });

  it('folds the whole negative side into changes-requested on GitHub', () => {
    // GitHub has no "waiting for author" review state, so both negative
    // verdicts have to land on the one state it does record.
    expect(verdictDecision('reject', 'github')).toBe('changes-requested');
    expect(verdictDecision('wait-for-author', 'github')).toBe(
      'changes-requested'
    );
  });

  it('keeps waiting-for-author apart from rejection elsewhere', () => {
    expect(verdictDecision('wait-for-author', 'azure-devops')).toBe(
      'waiting-for-author'
    );
    expect(verdictDecision('reject', 'azure-devops')).toBe('rejected');
  });

  it('treats an unknown provider like the general case, not like GitHub', () => {
    expect(verdictDecision('wait-for-author', undefined)).toBe(
      'waiting-for-author'
    );
    expect(verdictDecision('reject', undefined)).toBe('rejected');
  });
});
