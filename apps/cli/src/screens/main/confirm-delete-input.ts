import type { Key } from 'ink';
import { handleTextInput } from '../../utils/handle-text-input.js';
import type { DeleteConfirmHandlerCtx } from './input-types.js';

export function handleConfirmDeleteInput(
  input: string,
  key: Key,
  ctx: DeleteConfirmHandlerCtx
): void {
  const action = ctx.keybinds.resolve(input, key, 'confirm-delete');

  if (action === 'confirm-delete.cancel') {
    ctx.deleteConfirm.setConfirmDelete(null);
    ctx.deleteConfirm.setConfirmInput('');
    return;
  }
  if (action === 'confirm-delete.confirm') {
    if (
      ctx.deleteConfirm.confirmInput === ctx.deleteConfirm.confirmDelete!.branch
    ) {
      // Capture the names before clearing the modal state below — the
      // async runs after setConfirmDelete(null), and we need these for
      // the success toast too.
      const { sessionName, branch } = ctx.deleteConfirm.confirmDelete!;
      ctx.asyncOps.run('delete', async () => {
        await ctx.sessions.performDelete(sessionName, branch);
        ctx.sessions.flashStatus(`Deleted ${branch}`);
      });
    } else {
      ctx.sessions.flashStatus('Branch name did not match — delete cancelled');
    }
    ctx.deleteConfirm.setConfirmDelete(null);
    ctx.deleteConfirm.setConfirmInput('');
    return;
  }
  handleTextInput(input, key, ctx.deleteConfirm.setConfirmInput);
}
