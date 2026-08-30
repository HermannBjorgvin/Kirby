import { describe, it, expect } from 'vitest';
import { buildReviewLaunchRequest } from './review-prompt.js';

const pr = {
  id: 42,
  title: 'Add "quoted" feature',
  sourceBranch: 'feat/x',
  targetBranch: 'main',
  createdByDisplayName: 'Ada',
};

describe('buildReviewLaunchRequest', () => {
  it('seeds or continues a review with the add-comment guidance', () => {
    const req = buildReviewLaunchRequest(pr);
    expect(req.intent).toBe('continue-or-seed');
    expect(req.prompt).toContain('Review PR #42 ("Add "quoted" feature")');
    expect(req.prompt).toContain('feat/x → main');
    expect(req.prompt).toContain('by Ada');
    expect(req.systemGuidance).toContain('kirby util add-comment --pr=42');
    expect(req.prompt).not.toContain('ADDITIONAL USER INSTRUCTION');
  });

  it('appends a trimmed additional instruction', () => {
    const req = buildReviewLaunchRequest(pr, '  focus on error handling  ');
    expect(req.prompt).toMatch(
      /ADDITIONAL USER INSTRUCTION \(overrides previous where applicable\): focus on error handling$/
    );
  });

  it('falls back to the branch name when the title is empty', () => {
    const req = buildReviewLaunchRequest({ ...pr, title: '' });
    expect(req.prompt).toContain('Review PR #42 ("feat/x")');
  });
});
