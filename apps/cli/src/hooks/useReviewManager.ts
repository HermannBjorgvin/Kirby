import { useState } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { ReviewPane } from '../types.js';

export function useReviewManager() {
  const [reviewSelectedIndex, setReviewSelectedIndex] = useState(0);
  const [reviewReconnectKey, setReviewReconnectKey] = useState(0);
  const [reviewSessionStarted, setReviewSessionStarted] = useState<Set<number>>(
    new Set()
  );
  const [reviewConfirm, setReviewConfirm] = useState<{
    pr: PullRequestInfo;
    selectedOption: number;
  } | null>(null);
  const [reviewInstruction, setReviewInstruction] = useState('');
  const [reviewPane, setReviewPane] = useState<ReviewPane>('detail');
  const [diffFileIndex, setDiffFileIndex] = useState(0);
  const [diffViewFile, setDiffViewFile] = useState<string | null>(null);
  const [diffScrollOffset, setDiffScrollOffset] = useState(0);
  const [showSkipped, setShowSkipped] = useState(false);

  return {
    reviewSelectedIndex,
    setReviewSelectedIndex,
    reviewReconnectKey,
    setReviewReconnectKey,
    reviewSessionStarted,
    setReviewSessionStarted,
    reviewConfirm,
    setReviewConfirm,
    reviewInstruction,
    setReviewInstruction,
    reviewPane,
    setReviewPane,
    diffFileIndex,
    setDiffFileIndex,
    diffViewFile,
    setDiffViewFile,
    diffScrollOffset,
    setDiffScrollOffset,
    showSkipped,
    setShowSkipped,
  };
}
