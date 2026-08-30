import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className combiner (shadcn convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "3m ago" style relative timestamp. */
export function relativeTime(input: string | number): string {
  const then = typeof input === 'number' ? input : new Date(input).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Two-letter initials for an avatar chip. */
export function initials(name: string): string {
  const parts = name.replace(/[-_.]/g, ' ').trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// `navigator.platform` is deprecated; `userAgent` reports the same
// thing and is not. On macOS both carry "Mac", so the test is
// unchanged in behaviour.
export const isMac =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

/** Platform modifier label for shortcut hints. */
export const MOD = isMac ? '⌘' : 'Ctrl';
