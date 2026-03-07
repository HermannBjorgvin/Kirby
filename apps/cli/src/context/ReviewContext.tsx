import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { useReviewManager } from '../hooks/useReviewManager.js';
import { useSessionContext } from './SessionContext.js';

export interface ReviewContextValue {
  review: ReturnType<typeof useReviewManager>;
  allReviewPrs: PullRequestInfo[];
  selectedReviewPr: PullRequestInfo | undefined;
  reviewSessionName: string | null;
  clampedReviewIndex: number;
  reviewTotalItems: number;
}

const ReviewContext = createContext<ReviewContextValue | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const { categorizedReviews } = useSessionContext();

  const review = useReviewManager();

  const reviewTotalItems =
    categorizedReviews.needsReview.length +
    categorizedReviews.waitingForAuthor.length +
    categorizedReviews.approvedByYou.length;

  const clampedReviewIndex =
    reviewTotalItems > 0
      ? Math.min(review.reviewSelectedIndex, reviewTotalItems - 1)
      : 0;

  const allReviewPrs = useMemo(
    () => [
      ...categorizedReviews.needsReview,
      ...categorizedReviews.waitingForAuthor,
      ...categorizedReviews.approvedByYou,
    ],
    [categorizedReviews]
  );
  const selectedReviewPr = allReviewPrs[clampedReviewIndex];
  const reviewSessionName = selectedReviewPr
    ? `review-pr-${selectedReviewPr.id}`
    : null;

  const value = useMemo<ReviewContextValue>(
    () => ({
      review,
      allReviewPrs,
      selectedReviewPr,
      reviewSessionName,
      clampedReviewIndex,
      reviewTotalItems,
    }),
    [
      review,
      allReviewPrs,
      selectedReviewPr,
      reviewSessionName,
      clampedReviewIndex,
      reviewTotalItems,
    ]
  );

  return (
    <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
  );
}

export function useReviewContext(): ReviewContextValue {
  const ctx = useContext(ReviewContext);
  if (!ctx)
    throw new Error('useReviewContext must be used within ReviewProvider');
  return ctx;
}
