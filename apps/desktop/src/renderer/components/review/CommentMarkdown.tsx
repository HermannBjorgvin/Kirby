import { ExternalLinkIcon, ImageOffIcon } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useHighlightedCodeBlock } from '../../lib/highlight.js';
import { useCommentImage } from '../../lib/queries.js';
import { useTheme } from '../../lib/theme.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.js';
import { Skeleton } from '../ui/skeleton.js';

/**
 * Markdown body for PR comments.
 *  • Images are fetched by the host with the provider's credentials
 *    (Azure DevOps attachments need the PAT, private GitHub assets the
 *    gh token) and shown from a data URL; click opens a lightbox.
 *  • Links open in the system browser, never inside the app.
 *  • Headings are capped so a reply can't shout over the page.
 */
// Comment images render as block elements (and show a block skeleton
// while loading); a real <p> can't legally contain a <div>, so
// paragraphs render as <div> to keep the nesting valid.
function MarkdownParagraph(props: ComponentProps<'div'>) {
  return <div className="my-1.5" {...props} />;
}

const MARKDOWN_COMPONENTS = {
  img: CommentImage,
  a: ExternalAnchor,
  p: MarkdownParagraph,
  code: MarkdownCode,
};

export function CommentMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-base leading-relaxed prose-p:my-1.5 prose-pre:my-2 prose-pre:text-sm prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-a:text-primary prose-headings:my-2 prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-h4:text-base prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-table:my-2 prose-th:py-1 prose-th:px-2 prose-td:py-1 prose-td:px-2 prose-blockquote:my-2 prose-blockquote:border-l-border prose-hr:my-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function ExternalAnchor({ href, children, ...rest }: ComponentProps<'a'>) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:/i.test(href))
          void window.kirby.openExternal(href);
      }}
      title={href}
    >
      {children}
    </a>
  );
}

function CommentImage({ src, alt }: ComponentProps<'img'>) {
  const url = typeof src === 'string' ? src : '';
  const img = useCommentImage(url);
  const [open, setOpen] = useState(false);

  if (!url) return null;

  if (img.isLoading) {
    return (
      <span className="my-2 block">
        <Skeleton className="h-32 w-64 max-w-full" />
      </span>
    );
  }
  if (img.isError || !img.data) {
    return (
      <span className="my-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-sm text-muted-foreground">
        <ImageOffIcon className="size-3.5" />
        <span>{alt || 'image'}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          onClick={() => void window.kirby.openExternal(url)}
        >
          open <ExternalLinkIcon className="size-3" />
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="my-2 block cursor-zoom-in rounded-md border border-border bg-background p-0.5 text-left hover:border-ring"
        title={alt ? `${alt} — click to enlarge` : 'Click to enlarge'}
      >
        <img
          src={img.data.dataUrl}
          alt={alt ?? ''}
          className="!my-0 max-h-72 max-w-full rounded object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-auto max-w-[min(96vw,1400px)] overflow-auto p-3 sm:max-w-[min(96vw,1400px)]">
          <DialogTitle className="sr-only">{alt || 'Image'}</DialogTitle>
          <img
            src={img.data.dataUrl}
            alt={alt ?? ''}
            className="mx-auto block max-h-[84vh] max-w-full object-contain"
          />
          <div
            className={cn(
              'flex items-center justify-between gap-3 pt-2 text-sm text-muted-foreground'
            )}
          >
            <span className="truncate">
              {alt || 'image'} · {img.data.contentType} ·{' '}
              {(img.data.bytes / 1024).toFixed(0)} KB
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void window.kirby.openExternal(url)}
            >
              <ExternalLinkIcon /> Open original
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Markdown code: inline stays plain; fenced blocks (```lang) are
 * shiki-highlighted with the same colours as the diff viewer.
 */
function MarkdownCode({
  className,
  children,
  ...props
}: ComponentProps<'code'>) {
  const match = /language-([\w+-]+)/.exec(className ?? '');
  if (!match) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  return (
    <HighlightedCodeBlock
      code={String(children).replace(/\n$/, '')}
      tag={match[1]}
    />
  );
}

function HighlightedCodeBlock({ code, tag }: { code: string; tag: string }) {
  const { resolved } = useTheme();
  const lines = code.split('\n');
  const tokens = useHighlightedCodeBlock(code, tag, resolved);
  // The index is the identity here, so the usual objection to keying by
  // it does not apply: `lines` and `tokens` are a positional split of
  // one static `code` string, nothing reorders, and every span is a
  // leaf with no state. The "stable" alternative would be a character
  // offset, which is strictly worse — inserting a line changes the
  // offset of every line below it and remounts the whole block, where
  // the index reuses them.
  return (
    <code className="block">
      {lines.map((line, i) => (
        // eslint-disable-next-line react/no-array-index-key -- positional split; see above
        <span key={i} className="block">
          {tokens?.[i]
            ? tokens[i].map((tok, j) => (
                // eslint-disable-next-line react/no-array-index-key -- as above, within the line
                <span key={j} style={{ color: tok.color }}>
                  {tok.content}
                </span>
              ))
            : line || ' '}
        </span>
      ))}
    </code>
  );
}
