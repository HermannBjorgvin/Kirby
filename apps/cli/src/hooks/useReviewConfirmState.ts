import { useState } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';

export function useReviewConfirmState() {
  const [reviewConfirm, setReviewConfirm] = useState<{
    pr: PullRequestInfo;
    selectedOption: number;
  } | null>(null);
  const [reviewInstruction, setReviewInstruction] = useState('');

  return {
    reviewConfirm,
    setReviewConfirm,
    reviewInstruction,
    setReviewInstruction,
  };
}
