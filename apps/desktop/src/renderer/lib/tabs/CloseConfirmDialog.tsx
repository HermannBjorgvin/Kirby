import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';

/** What a close is about to stop, and the confirmation it asks for. */
export interface PendingClose {
  /** Branches whose agents are actively working right now. */
  activeBranches: string[];
  /** Terminal tabs closing — every one asks, on both backends, because
   *  closing a terminal tab ends its session. */
  terminals: string[];
  /** Kill + close, once the user confirms. */
  run: () => void;
}

function Mono({ names }: { names: string[] }) {
  return (
    <>
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 && ', '}
          <span className="font-mono text-foreground">{n}</span>
        </span>
      ))}
    </>
  );
}

export function CloseConfirmDialog({
  pending,
  onCancel,
}: {
  pending: PendingClose;
  onCancel: () => void;
}) {
  const agents = pending.activeBranches;
  const terms = pending.terminals;
  const plural = (n: number) => (n === 1 ? ' is' : 's are');
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {agents.length > 0
              ? `Agent${plural(agents.length)} still working`
              : `Close terminal${terms.length === 1 ? '' : 's'}?`}
          </DialogTitle>
          <DialogDescription>
            {agents.length > 0 && (
              <>
                <Mono names={agents} /> {agents.length === 1 ? 'is' : 'are'}{' '}
                actively producing output. Closing the tab stops the agent.{' '}
              </>
            )}
            {terms.length > 0 && (
              <>
                Closing <Mono names={terms} /> ends the session running there.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Keep {agents.length > 0 ? 'working' : 'open'}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onCancel();
              pending.run();
            }}
          >
            {agents.length > 0 ? 'Stop agent & close' : 'End session & close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
