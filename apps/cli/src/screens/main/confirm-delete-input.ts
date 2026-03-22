import type { Key } from 'ink';
import { handleTextInput } from '../../utils/handle-text-input.js';
import type { DeleteConfirmHandlerCtx } from './input-types.js';
import { ACTIONS, resolveAction } from '../../keybindings/index.js';

export function handleConfirmDeleteInput(
  input: string,
  key: Key,
  ctx: DeleteConfirmHandlerCtx
): void {
  const action = resolveAction(
    input,
    key,
    'confirm-delete',
    ctx.keybinds.bindings,
    ACTIONS
  );

  if (action === 'confirm-delete.cancel') {
    ctx.deleteConfirm.setConfirmDelete(null);
    ctx.deleteConfirm.setConfirmInput('');
    return;
  }
  if (action === 'confirm-delete.confirm') {
    if (
      ctx.deleteConfirm.confirmInput === ctx.deleteConfirm.confirmDelete!.branch
    ) {
      ctx.asyncOps.run('delete', async () => {
        await ctx.sessions.performDelete(
          ctx.deleteConfirm.confirmDelete!.sessionName,
          ctx.deleteConfirm.confirmDelete!.branch
        );
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
