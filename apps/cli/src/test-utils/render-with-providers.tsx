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

/**
 * Mount a component inside ConfigProvider → KeybindProvider → ToastProvider
 * for use in `ink-testing-library` specs. Keep the wrapping minimal — specs
 * that need more layers (SessionProvider, SidebarProvider, LayoutProvider)
 * can wrap the node themselves before passing it in.
 */
export function renderWithProviders(
  node: ReactElement,
  options: RenderWithProvidersOptions = {}
) {
  const providers = options.providers ?? [];
  return inkRender(
    <ConfigProvider providers={providers}>
      <KeybindProvider>
        <ToastProvider>{node}</ToastProvider>
      </KeybindProvider>
    </ConfigProvider>
  );
}
