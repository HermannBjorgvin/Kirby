import type { ElectronApplication } from '@playwright/test';

/**
 * The OS folder picker is a native dialog: Playwright drives the page,
 * not the window manager, so it can neither see nor click it. The host
 * reaches it through `dialog.showOpenDialog` at call time, which makes
 * the module object the seam — the next call answers with `dir`, as a
 * user picking that folder would, and the one after that is native
 * again.
 */
export async function armFolderPick(
  app: ElectronApplication,
  dir: string
): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    const original = dialog.showOpenDialog;
    (dialog as { showOpenDialog: unknown }).showOpenDialog = async () => {
      (dialog as { showOpenDialog: unknown }).showOpenDialog = original;
      return { canceled: false, filePaths: [picked] };
    };
  }, dir);
}
