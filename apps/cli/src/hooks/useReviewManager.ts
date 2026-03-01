import { useState, useEffect, useMemo } from 'react';
import type { PullRequestInfo, CategorizedReviews } from '@kirby/vcs-core';

export function useReviewManager() {
  const [reviewSelectedIndex, setReviewSelectedIndex] = useState(0);
  const [reviewPaneContent, setReviewPaneContent] = useState('');
  const [reviewReconnectKey, setReviewReconnectKey] = useState(0);
  const [reviewSessionStarted, setReviewSessionStarted] = useState<Set<number>>(
    new Set()
  );
  const [reviewConfirm, setReviewConfirm] = useState<{
    pr: PullRequestInfo;
    selectedOption: number;
  } | null>(null);
  const [reviewInstruction, setReviewInstruction] = useState('');

  return {
    reviewSelectedIndex,
    setReviewSelectedIndex,
    reviewPaneContent,
    setReviewPaneContent,
    reviewReconnectKey,
    setReviewReconnectKey,
    reviewSessionStarted,
    setReviewSessionStarted,
    reviewConfirm,
    setReviewConfirm,
    reviewInstruction,
    setReviewInstruction,
  };
}
