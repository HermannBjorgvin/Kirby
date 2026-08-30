import { lazy } from 'react';

/**
 * The two editor panes that are loaded on demand rather than at boot.
 *
 * **Why.** Everything the window needs to paint its shell — title bar,
 * sidebar, tab strip, status bar — is a small fraction of the renderer
 * bundle. The rest is behind these two doors: the review workspace
 * drags in the whole markdown stack (micromark, mdast, unified,
 * hast — around 420 kB before minification), the terminal emulator,
 * and the diff virtualizer; the settings pane drags in a select
 * widget. None of that can be on screen until the user opens a tab,
 * and all of it was being parsed and evaluated before the first paint.
 *
 * **Why prefetching matters as much as splitting.** A split that made
 * the first tab open slower would be a bad trade — the app auto-opens
 * a tab for every agent already running, so "the first tab" is often
 * something the user did not even ask for. `prefetchPanes` pulls both
 * chunks in on the first idle callback after the shell is up, so they
 * are in memory well before anything is clicked, and the load is paid
 * out of time the app was doing nothing anyway.
 */

const importPrWorkspace = () => import('../review/PrWorkspace.js');
const importSettingsView = () => import('../settings/SettingsView.js');

export const PrWorkspace = lazy(() =>
  importPrWorkspace().then((m) => ({ default: m.PrWorkspace }))
);

export const SettingsView = lazy(() =>
  importSettingsView().then((m) => ({ default: m.SettingsView }))
);

/**
 * Warm both chunks once the browser has nothing better to do.
 *
 * Failures are swallowed on purpose: this is an optimisation, and if
 * the import fails here it will fail again — visibly, inside the pane's
 * ErrorBoundary — when something actually needs it. Reporting it twice
 * would only mean reporting it once too early.
 */
export function prefetchPanes(): void {
  const warm = () => {
    void importPrWorkspace().catch(() => undefined);
    void importSettingsView().catch(() => undefined);
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warm, { timeout: 2_000 });
  } else {
    setTimeout(warm, 500);
  }
}

/**
 * What a pane shows while its chunk arrives.
 *
 * Deliberately blank rather than a spinner. The chunks come off local
 * disk in a handful of milliseconds and are usually already warm, so
 * anything with motion in it would be a flicker rather than feedback —
 * and the panes behind this each bring their own skeletons for the
 * waits that are real (the diff, the comments, the agent).
 */
export function PaneLoading() {
  return <div className="h-full bg-background" />;
}
