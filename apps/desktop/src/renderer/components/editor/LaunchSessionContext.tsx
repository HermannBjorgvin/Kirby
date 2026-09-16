import type { ReactNode } from 'react';
import type { SessionLaunchView } from '../../../host/contract.js';
import { relativeTime } from '../../lib/utils.js';

export function ContinueContext({ info }: { info: SessionLaunchView }) {
  return (
    <>
      <dl className="space-y-3">
        <Detail label="Last agent">
          {info.recordedAgentName ?? 'Unknown'}
        </Detail>
        <Detail label="Conversation">
          {info.running ? 'Running' : 'Stopped · ready to continue'}
        </Detail>
      </dl>
      {(info.orchestrator || info.lastReport) && (
        <section
          aria-label="Orchestra context"
          className="space-y-3 border-t pt-4"
        >
          <h3 className="font-medium">Orchestra</h3>
          <dl className="space-y-3">
            {info.orchestrator && (
              <Detail label="Reporting to">{info.orchestrator}</Detail>
            )}
            {info.lastReport && (
              <Detail label="Last report">
                <span>{info.lastReport.kind}</span> ·{' '}
                <time dateTime={info.lastReport.timestamp}>
                  {relativeTime(info.lastReport.timestamp)}
                </time>
              </Detail>
            )}
          </dl>
        </section>
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
