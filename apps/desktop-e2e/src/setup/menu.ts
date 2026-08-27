import type { ElectronApplication } from '@playwright/test';

/**
 * Native context menus can't be clicked from the renderer side: the
 * desktop deliberately uses `Menu.popup` (main process, real OS menu)
 * rather than a web-rendered menu, and Playwright drives the page, not
 * the window manager.
 *
 * So we arm a one-shot interception in the main process: the next
 * `Menu.popup` picks the item with the given label, fires its click
 * handler and resolves the popup's callback, exactly as a user's click
 * would. `popupContextMenu` in main.ts reads its result from that
 * click, so the renderer sees a genuine selection.
 */
export async function armContextMenuChoice(
  app: ElectronApplication,
  label: string
): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    const proto = Menu.prototype as unknown as {
      popup: (opts?: { callback?: () => void }) => void;
    };
    const original = proto.popup;
    proto.popup = function patched(this: Electron.Menu, opts) {
      proto.popup = original; // one-shot
      const item = this.items.find((i) => i.label === wanted);
      if (!item) {
        const labels = this.items.map((i) => i.label).join(', ');
        throw new Error(
          `Context menu has no item "${wanted}". Items: ${labels}`
        );
      }
      if (item.enabled === false) {
        throw new Error(`Context menu item "${wanted}" is disabled`);
      }
      (item as unknown as { click?: () => void }).click?.();
      opts?.callback?.();
    };
  }, label);
}

/**
 * Arm the next `Menu.popup` to dismiss without choosing anything —
 * the equivalent of pressing Escape over an open context menu.
 */
export async function armContextMenuDismiss(
  app: ElectronApplication
): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const proto = Menu.prototype as unknown as {
      popup: (opts?: { callback?: () => void }) => void;
    };
    const original = proto.popup;
    proto.popup = function patched(opts) {
      proto.popup = original;
      opts?.callback?.();
    };
  });
}
