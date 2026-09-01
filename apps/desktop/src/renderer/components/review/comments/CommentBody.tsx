import {
  AGENT_ATTRIBUTION,
  commentBodyParts,
} from '@kirby/review-comments/conventional';
import { useMemo } from 'react';
import { conventionalBadge } from '../../../lib/review/severity.js';
import { Badge } from '../../ui/badge.js';
import { CommentMarkdown } from './CommentMarkdown.js';

/**
 * One comment body, as a card draws it.
 *
 * A Conventional Comments header (conventionalcomments.org) is a
 * classification, not a sentence, so it renders as badges and comes
 * out of the prose — leaving the subject as the comment's first line,
 * which is what it always was. A body with no header renders whole,
 * which is most of them: reviewers' comments go through here too.
 *
 * The agent attribution renders as an aside under a rule. It is a
 * signature — true, worth having, and not something a reader should
 * have to wade through on the way to the next comment.
 *
 * Both shells split the body with the same `commentBodyParts`, so the
 * badge a reviewer sees here is the one the TUI shows for the same
 * comment.
 */
export function CommentBody({ markdown }: { markdown: string }) {
  const parts = useMemo(() => commentBodyParts(markdown), [markdown]);
  return (
    <>
      {parts.header && (
        <div className="mb-1 flex flex-wrap items-center gap-1">
          <Badge variant={conventionalBadge(parts.header)}>
            {parts.header.label}
          </Badge>
          {parts.header.decorations.map((decoration) => (
            <Badge key={decoration} variant="outline">
              {decoration}
            </Badge>
          ))}
        </div>
      )}
      <CommentMarkdown markdown={parts.body} />
      {parts.footer && <AgentAttribution />}
    </>
  );
}

/**
 * The signature line.
 *
 * Rendered from the attribution's parts rather than by running its
 * markdown back through the comment renderer: that renderer sets the
 * prose type scale, which is precisely what this is trying not to be.
 * The parts and the posted markdown come from one constant, so the two
 * cannot say different things.
 */
function AgentAttribution() {
  return (
    <div className="mt-2 border-t border-border pt-1.5 text-xs italic text-muted-foreground">
      {AGENT_ATTRIBUTION.prefix}
      <button
        type="button"
        className="underline underline-offset-2 hover:text-foreground"
        onClick={() => void window.kirby.openExternal(AGENT_ATTRIBUTION.url)}
      >
        {AGENT_ATTRIBUTION.linkText}
      </button>
      {AGENT_ATTRIBUTION.suffix}
    </div>
  );
}
