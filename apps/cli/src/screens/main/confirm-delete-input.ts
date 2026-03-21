import type { Key } from 'ink';
import { handleTextInput } from '../../utils/handle-text-input.js';
import type { DeleteConfirmHandlerCtx } from './input-types.js';

export function handleConfirmDeleteInput(
  input: string,
  key: Key,
  ctx: DeleteConfirmHandlerCtx
): void {
  if (key.escape) {
    ctx.deleteConfirm.setConfirmDelete(null);
    ctx.deleteConfirm.setConfirmInput('');
    return;
  }
  if (key.return) {
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
