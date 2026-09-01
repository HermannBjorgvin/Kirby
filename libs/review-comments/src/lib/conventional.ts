import type { CommentSeverity } from './types.js';

/**
 * Conventional Comments — https://conventionalcomments.org
 *
 *   <label> [decorations]: <subject>
 *
 *   <discussion>
 *
 * A review comment's first line says what kind of remark it is and how
 * much it binds, so a reader can tell "this blocks the merge" from "I
 * would have named it differently" without reading the paragraph
 * underneath. Kirby's agents write in this shape, and both shells
 * render the header as badges rather than as the first line of prose.
 *
 * Everything here is pure — no `node:` builtin, no I/O — because the
 * Electron renderer, which is a sandboxed browser context, parses the
 * same bodies the TUI does. `@kirby/review-comments/conventional` is
 * the browser-safe entry that exposes it; the package's main barrel
 * reaches the filesystem and is off-limits there.
 *
 * The parser is deliberately conservative. It recognises a header only
 * when the body *starts* with one of the nine labels, so an ordinary
 * comment — a human's, or one written before any of this existed —
 * passes through untouched rather than having its first line eaten.
 */

/** The nine labels, in the order the specification lists them. */
export const CONVENTIONAL_LABELS = [
  'praise',
  'nitpick',
  'suggestion',
  'issue',
  'todo',
  'question',
  'thought',
  'chore',
  'note',
] as const;

export type ConventionalLabel = (typeof CONVENTIONAL_LABELS)[number];

/**
 * The decorations the specification names. Others parse fine — a
 * decoration is free text and teams invent their own — so this is the
 * set we *write*, not the set we accept.
 */
export const CONVENTIONAL_DECORATIONS = [
  'blocking',
  'non-blocking',
  'if-minor',
] as const;

export interface ConventionalComment {
  label: ConventionalLabel;
  /** Lower-cased, in written order; empty when the header had none. */
  decorations: string[];
  /** The rest of the header line. Never empty, never multi-line. */
  subject: string;
  /** The discussion under the header. Empty when there is none. */
  body: string;
}

const LABELS = new Set<string>(CONVENTIONAL_LABELS);

/**
 * `label`, an optional `(a, b)` group, a colon, then the subject.
 *
 * Anchored at the start of the string: a header is a *prefix* of the
 * comment or it is not a header at all. Without the anchor, a line
 * halfway down a paragraph would silently become the badge on a
 * comment whose actual first line is something else.
 */
const HEADER_RE = /^([A-Za-z]+)[ \t]*(?:\(([^)\n]*)\))?[ \t]*:[ \t]*(.*)$/;

/** Leading blank lines, which formatting adds and meaning does not. */
const LEADING_BLANK_RE = /^(?:[ \t]*\r?\n)+/;

/**
 * Read a Conventional Comments header off the front of `text`.
 *
 * Returns `null` for anything else, which is the common case and has
 * to stay cheap and total: every comment body in the app runs through
 * here on its way to being rendered.
 */
export function parseConventionalComment(
  text: string
): ConventionalComment | null {
  // A CRLF body reaches us from a Windows editor or a provider that
  // kept the line endings it was given. The header line survives
  // either way (it is trimmed), but a stray \r left in the discussion
  // is painted literally by a terminal, so normalise once here rather
  // than at each of the places that render the result.
  const trimmed = text.replace(/\r\n/g, '\n').replace(LEADING_BLANK_RE, '');
  const newline = trimmed.indexOf('\n');
  const firstLine = newline === -1 ? trimmed : trimmed.slice(0, newline);
  const rest = newline === -1 ? '' : trimmed.slice(newline + 1);

  const match = HEADER_RE.exec(firstLine.trimEnd());
  if (!match) return null;

  const label = match[1].toLowerCase();
  if (!LABELS.has(label)) return null;

  const subject = match[3].trim();
  // "issue:" on its own is a label with nothing said. Treating it as a
  // header would leave a badge over an empty comment and hide whatever
  // follows on the next line.
  if (!subject) return null;

  const decorations = (match[2] ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);

  return {
    label: label as ConventionalLabel,
    decorations,
    subject,
    body: rest.replace(LEADING_BLANK_RE, '').trimEnd(),
  };
}

/** Render a parsed comment back to its wire form. */
export function formatConventionalComment(c: ConventionalComment): string {
  const decorations =
    c.decorations.length > 0 ? ` (${c.decorations.join(', ')})` : '';
  const header = `${c.label}${decorations}: ${c.subject}`;
  const body = c.body.trim();
  return body ? `${header}\n\n${body}` : header;
}

// ── Severity ↔ label ─────────────────────────────────────────────

/**
 * How an agent's severity is said in the shared vocabulary.
 *
 * Kirby's agents pick a severity because that is what the diff viewer
 * sorts and colours by; the reviewer on the other end reads a label.
 * These are the same judgement in two vocabularies, so the mapping
 * lives here rather than in whichever caller happens to need it.
 */
export function conventionalForSeverity(severity: CommentSeverity): {
  label: ConventionalLabel;
  decorations: string[];
} {
  switch (severity) {
    case 'critical':
      return { label: 'issue', decorations: ['blocking'] };
    case 'major':
      return { label: 'issue', decorations: ['non-blocking'] };
    case 'minor':
      return { label: 'suggestion', decorations: ['non-blocking'] };
    case 'nit':
      return { label: 'nitpick', decorations: ['non-blocking'] };
  }
}

/** Label → severity, for everything that is coloured by severity. */
const LABEL_SEVERITY: Record<ConventionalLabel, CommentSeverity> = {
  issue: 'major',
  todo: 'major',
  suggestion: 'minor',
  question: 'minor',
  chore: 'minor',
  nitpick: 'nit',
  praise: 'nit',
  note: 'nit',
  thought: 'nit',
};

/** Quietest first — the scale the label and the severity share. */
const SEVERITY_RANK: Record<CommentSeverity, number> = {
  nit: 0,
  minor: 1,
  major: 2,
  critical: 3,
};

/** The louder of two verdicts; `a` wins a tie. */
export function moreSevere(
  a: CommentSeverity,
  b: CommentSeverity
): CommentSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * How loudly a header should read.
 *
 * `blocking` is the one decoration that outranks its label: it is the
 * author saying the merge stops here, which is the same claim
 * `critical` makes. Nothing demotes — a comment that says it is
 * non-blocking is still whatever kind of remark its label says it is.
 */
export function conventionalSeverity(
  header: Pick<ConventionalComment, 'label' | 'decorations'>
): CommentSeverity {
  if (header.decorations.includes('blocking')) return 'critical';
  return LABEL_SEVERITY[header.label];
}

// ── Agent attribution ────────────────────────────────────────────

export const KIRBY_URL = 'https://github.com/HermannBjorgvin/Kirby';

/**
 * The line that says a machine wrote this.
 *
 * It goes at the *end*. A comment's opening words are the ones a
 * reviewer reads in a notification and in a collapsed thread, and
 * spending them on provenance ("AI generated: …") buries the point of
 * the comment behind a disclaimer. The claim still has to be made —
 * so it is made where a signature goes.
 */
export const AGENT_ATTRIBUTION = {
  prefix: 'Posted via ',
  linkText: 'Kirby',
  url: KIRBY_URL,
  suffix: ' by an agent',
} as const;

/**
 * The wire form: one italic line with one link.
 *
 * Derived from {@link AGENT_ATTRIBUTION} rather than written out, so
 * the shells — which render the pieces as small text and a link rather
 * than by re-parsing this markdown — cannot drift from what is
 * actually posted.
 */
export const AGENT_FOOTER =
  `_${AGENT_ATTRIBUTION.prefix}` +
  `[${AGENT_ATTRIBUTION.linkText}](${AGENT_ATTRIBUTION.url})` +
  `${AGENT_ATTRIBUTION.suffix}_`;

const FOOTER_RE = new RegExp(
  `(?:\\r?\\n)+(?:-{3,}(?:\\r?\\n)+)?${escapeRegExp(AGENT_FOOTER)}\\s*$`
);

/** A footer on its own, for a body that is nothing else. */
const BARE_FOOTER_RE = new RegExp(`^\\s*${escapeRegExp(AGENT_FOOTER)}\\s*$`);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sign `body` as agent-written. */
export function withAgentFooter(body: string): string {
  return `${body.trimEnd()}\n\n---\n${AGENT_FOOTER}`;
}

/**
 * Split the attribution off a body so it can be rendered as the aside
 * it is, rather than as a last paragraph of the comment.
 *
 * Anything that is not ours comes back unchanged with a null footer,
 * so this is safe to run over every comment in a thread.
 */
export function splitAgentFooter(text: string): {
  body: string;
  footer: string | null;
} {
  if (BARE_FOOTER_RE.test(text)) return { body: '', footer: AGENT_FOOTER };
  const match = FOOTER_RE.exec(text);
  if (!match) return { body: text, footer: null };
  return { body: text.slice(0, match.index).trimEnd(), footer: AGENT_FOOTER };
}

// ── What a card draws ────────────────────────────────────────────

export interface CommentBodyParts {
  /** The header, when the body has one; null leaves the body verbatim. */
  header: ConventionalComment | null;
  /** The prose to render: subject and discussion, no header, no footer. */
  body: string;
  /** The agent attribution, to render as an aside, or null. */
  footer: string | null;
}

/**
 * One comment body, split into the three things a card draws.
 *
 * Both shells call this rather than each doing its own splitting,
 * because the TUI's scroll model measures a card by re-deriving what
 * it will paint — so a card that renders one set of pieces and is
 * measured against another puts every row below it in the wrong place.
 */
export function commentBodyParts(text: string): CommentBodyParts {
  const { body, footer } = splitAgentFooter(text.replace(/\r\n/g, '\n'));
  const header = parseConventionalComment(body);
  if (!header) return { header: null, body, footer };
  return {
    header,
    body: header.body ? `${header.subject}\n\n${header.body}` : header.subject,
    footer,
  };
}

// ── Reconciling the two vocabularies ─────────────────────────────

export interface ResolvedComment {
  /** The header the comment is posted under. */
  header: ConventionalComment;
  /** What the whole app should treat the comment as. */
  severity: CommentSeverity;
}

function firstLine(body: string): string {
  const at = body.indexOf('\n');
  return (at === -1 ? body : body.slice(0, at)).trim();
}

function afterFirstLine(body: string): string {
  const at = body.indexOf('\n');
  return at === -1 ? '' : body.slice(at + 1).trim();
}

/**
 * Settle a draft's header and its severity against each other.
 *
 * A draft carries both a `--severity` and a body that may open with a
 * label of its own, and the two are the same judgement said twice — so
 * they must not be allowed to disagree. They can, in two ways, and
 * both were live:
 *
 *  - The agent writes a sharper header than its severity implies
 *    (`--severity=nit` with `question (blocking): …`, which the launch
 *    guidance actively invites). Taking the header alone posted a
 *    blocking question while every severity-driven surface — the
 *    walkthrough order, the rail dot, the TUI's `[nit]` chip — went on
 *    calling it a nit.
 *  - Ordinary prose happens to start with a label word. "Note: this
 *    drops writes on crash" is a sentence, not a header, and reading it
 *    as one turned a `critical` finding into the quietest label in the
 *    vocabulary.
 *
 * So the louder verdict wins, and a tie goes to the agent's own words,
 * which are more specific than a four-value enum. A header that would
 * quieten the comment keeps its subject and loses its label: the
 * sentence survives, the severity is not talked down.
 */
export function resolveComment(
  body: string,
  declared: CommentSeverity
): ResolvedComment {
  const parts = commentBodyParts(body);
  const authored = parts.header;

  if (!authored) {
    return {
      severity: declared,
      header: {
        ...conventionalForSeverity(declared),
        // With no header of its own, the first line is the subject and
        // the rest is the discussion under it.
        subject: firstLine(parts.body),
        body: afterFirstLine(parts.body),
      },
    };
  }

  const severity = moreSevere(conventionalSeverity(authored), declared);
  if (severity === conventionalSeverity(authored)) {
    return { severity, header: authored };
  }
  return {
    severity,
    header: {
      ...conventionalForSeverity(severity),
      subject: authored.subject,
      body: authored.body,
    },
  };
}
