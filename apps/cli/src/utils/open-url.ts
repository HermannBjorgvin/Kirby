import { spawn } from 'node:child_process';

// Open a URL in the user's default browser. Needed because Kirby's
// SGR mouse tracking captures plain clicks, so the terminal no longer
// opens OSC-8 hyperlinks itself — the sidebar click handler routes
// PR-badge clicks here instead. Fire-and-forget; failures are
// irrelevant to the TUI.
export function openUrl(url: string): void {
  if (!/^https?:\/\//.test(url)) return;
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url] as string[]]
      : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Opening a browser is best-effort only.
  }
}
