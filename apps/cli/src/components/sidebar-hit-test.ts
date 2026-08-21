import type { SidebarHit } from './sidebar-hit-regions.js';

// Module-level registry (same pattern as pty-registry / inactive-alerts):
// the Sidebar publishes its current hit test after every layout pass,
// and MainTab's click handler consumes it. Null while the sidebar is
// hidden or unmounted.
export const sidebarHitTestRef: {
  current: ((y: number) => SidebarHit | null) | null;
} = { current: null };
