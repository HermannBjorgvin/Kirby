import { cn } from '../lib/utils.js';

/** Tiny inline logomark: a rounded square with a branching path. */
export function KirbyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn('text-primary', className)}
    >
      <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" />
      <path
        d="M8 7v10M8 12c0-2.5 2-3.5 4-3.5h1M16 7a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM8 15.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM8 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
