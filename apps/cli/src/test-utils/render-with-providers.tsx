import type { ReactElement } from 'react';
import { render as inkRender } from 'ink-testing-library';
import type { VcsProvider } from '@kirby/vcs-core';
import { ConfigProvider } from '../context/ConfigContext.js';
import { KeybindProvider } from '../context/KeybindContext.js';
import { ToastProvider } from '../context/ToastContext.js';

export interface RenderWithProvidersOptions {
  /** VCS providers available to ConfigProvider. Defaults to []. */
  providers?: VcsProvider[];
}

// ink-testing-library's return type references unexported classes
// with `private` fields, which tsc can't name when emitting our own
// declarations. Re-shape the return as a structural type so the
// consumer API stays identical without dragging in private members.
export interface RenderWithProvidersResult {
  rerender: (tree: ReactElement) => void;
  unmount: () => void;
  cleanup: () => void;
  stdout: {
    write: (frame: string) => void;
    readonly frames: string[];
    lastFrame: () => string | undefined;
  };
  stderr: {
    write: (frame: string) => void;
    readonly frames: string[];
    lastFrame: () => string | undefined;
  };
  stdin: {
    write: (data: string) => void;
  };
  frames: string[];
  lastFrame: () => string | undefined;
}

/**
 * Mount a component inside ConfigProvider → KeybindProvider → ToastProvider
 * for use in `ink-testing-library` specs. Keep the wrapping minimal — specs
 * that need more layers (SessionProvider, SidebarProvider, LayoutProvider)
 * can wrap the node themselves before passing it in.
 */
export function renderWithProviders(
  node: ReactElement,
  options: RenderWithProvidersOptions = {}
): RenderWithProvidersResult {
  const providers = options.providers ?? [];
  return inkRender(
    <ConfigProvider providers={providers}>
      <KeybindProvider>
        <ToastProvider>{node}</ToastProvider>
      </KeybindProvider>
    </ConfigProvider>
  );
}
