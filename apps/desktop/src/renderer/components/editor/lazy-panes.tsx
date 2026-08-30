import { useEffect, useState, type ComponentType } from 'react';
import type { PrWorkspace as PrWorkspaceType } from '../review/PrWorkspace.js';

/**
 * The two editor panes that are loaded on demand rather than at boot.
 *
 * **Why split.** Everything the window needs to paint its shell —
 * title bar, sidebar, tab strip, status bar — is a small fraction of
 * the renderer bundle. The rest is behind these two doors: the review
 * workspace drags in the whole markdown stack (micromark, mdast,
 * unified, hast — around 420 kB before minification), the terminal
 * emulator and the diff virtualizer; the settings pane drags in a
 * select widget. None of it can be on screen until a tab is open, and
 * all of it was otherwise parsed and evaluated before the first paint.
 *
 * **Why not `React.lazy`.** The pane mounts inside a
 * `useDeferredValue` render, and a component that suspends during one
 * of those meets React's retry throttle: the retry is held back a few
 * hundred milliseconds so a fallback cannot flash past. That is right
 * for a spinner nobody should see and wrong here, where the module is
 * already in memory and the delay buys nothing. Measured on the
 * open-timeline probe: a tab took 362 ms to get as far as asking for
 * its diff under `lazy`, against 70 ms without — and waiting three
 * seconds before clicking, so the module was certainly loaded, moved
 * it to 355 ms. The throttle was the cost, not the loading.
 *
 * So the module is fetched into a variable and read from there. A pane
 * whose module has arrived renders it synchronously, with nothing to
 * suspend and nothing to throttle; one that gets there first shows
 * `PaneLoading` and swaps in on an ordinary state update.
 *
 * **Why prefetching still matters.** The app auto-opens a tab for
 * every agent already running, so "the first tab" is often one nobody
 * asked for. `prefetchPanes` pulls both modules in on the first idle
 * callback after the shell mounts, out of time the app was doing
 * nothing anyway.
 */

type PrWorkspaceProps = Parameters<typeof PrWorkspaceType>[0];
/** The settings pane takes no props; `object` is the empty prop bag. */
type SettingsViewProps = object;

interface Loader<P> {
  /** The component, once its module has arrived. */
  value: ComponentType<P> | null;
  /** The in-flight import, so concurrent callers share one. */
  inflight: Promise<void> | null;
  load(): Promise<void>;
}

function loader<P>(
  importer: () => Promise<Record<string, unknown>>,
  exportName: string
): Loader<P> {
  const self: Loader<P> = {
    value: null,
    inflight: null,
    load: () => {
      self.inflight ??= importer().then((mod) => {
        self.value = mod[exportName] as ComponentType<P>;
      });
      return self.inflight;
    },
  };
  return self;
}

const prWorkspace = loader<PrWorkspaceProps>(
  () => import('../review/PrWorkspace.js'),
  'PrWorkspace'
);
const settingsView = loader<SettingsViewProps>(
  () => import('../settings/SettingsView.js'),
  'SettingsView'
);

/**
 * Make sure `l`'s module is on its way, and re-render when it lands.
 *
 * The component itself is read from module scope at the call site
 * rather than returned from here. That is not a style choice: a
 * component value that arrives through a hook looks, to the static
 * analysis, like one being *created* per render — the thing that
 * silently resets a subtree's state. These are imported once and never
 * replaced, so reading them where they live says so.
 */
function usePaneModule<P>(l: Loader<P>): void {
  const [, bump] = useState(0);
  useEffect(() => {
    if (l.value) return;
    let alive = true;
    void l.load().then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [l]);
}

export function PrWorkspace(props: PrWorkspaceProps) {
  usePaneModule(prWorkspace);
  const Pane = prWorkspace.value;
  return Pane ? <Pane {...props} /> : <PaneLoading />;
}

export function SettingsView() {
  usePaneModule(settingsView);
  const Pane = settingsView.value;
  return Pane ? <Pane /> : <PaneLoading />;
}

/**
 * Warm both modules once the browser has nothing better to do.
 *
 * Failures are swallowed on purpose: this is an optimisation, and if
 * the import fails here it will fail again — visibly, inside the pane's
 * ErrorBoundary — when something actually needs it. Reporting it twice
 * would only mean reporting it once too early.
 */
export function prefetchPanes(): void {
  const warm = () => {
    void prWorkspace.load().catch(() => undefined);
    void settingsView.load().catch(() => undefined);
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warm, { timeout: 2_000 });
  } else {
    setTimeout(warm, 500);
  }
}

/**
 * What a pane shows while its module arrives.
 *
 * Deliberately blank rather than a spinner. The modules come off local
 * disk in a handful of milliseconds and are usually already warm, so
 * anything with motion in it would be a flicker rather than feedback —
 * and the panes behind this each bring their own skeletons for the
 * waits that are real (the diff, the comments, the agent).
 */
export function PaneLoading() {
  return <div className="h-full bg-background" />;
}
