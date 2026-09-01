import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  AGENT_FOOTER,
  CONVENTIONAL_LABELS,
  commentBodyParts,
  conventionalForSeverity,
  conventionalSeverity,
  formatConventionalComment,
  parseConventionalComment,
  splitAgentFooter,
  withAgentFooter,
  type ConventionalComment,
} from './conventional.js';
import type { CommentSeverity } from './types.js';

/**
 * Reading and writing Conventional Comments.
 *
 * The parser runs over every comment body the app renders — reviewers'
 * as well as agents' — so the property that matters most is what it
 * does to text that is *not* one of these: nothing at all. A parser
 * that guesses eats the first line of somebody's comment and puts a
 * badge over the rest.
 */

describe('parseConventionalComment', () => {
  it('reads a bare label and subject', () => {
    expect(parseConventionalComment('issue: This leaks a handle.')).toEqual({
      label: 'issue',
      decorations: [],
      subject: 'This leaks a handle.',
      body: '',
    });
  });

  it('reads one decoration', () => {
    expect(
      parseConventionalComment('issue (blocking): This leaks a handle.')
    ).toMatchObject({ label: 'issue', decorations: ['blocking'] });
  });

  it('reads several decorations in the order written', () => {
    expect(
      parseConventionalComment('suggestion (non-blocking, if-minor): Rename.')
        ?.decorations
    ).toEqual(['non-blocking', 'if-minor']);
  });

  it('keeps the discussion under the header', () => {
    const parsed = parseConventionalComment(
      'issue (blocking): This leaks a handle.\n\nThe fd opened on line 12\nis never closed.'
    );
    expect(parsed?.subject).toBe('This leaks a handle.');
    expect(parsed?.body).toBe('The fd opened on line 12\nis never closed.');
  });

  it('normalises the case of the label and its decorations', () => {
    expect(parseConventionalComment('Issue (Blocking): X')).toMatchObject({
      label: 'issue',
      decorations: ['blocking'],
    });
  });

  it('accepts every label in the specification', () => {
    for (const label of CONVENTIONAL_LABELS) {
      expect(parseConventionalComment(`${label}: something`)?.label).toBe(
        label
      );
    }
  });

  it('tolerates the blank lines formatting leaves in front', () => {
    expect(parseConventionalComment('\n\nnote: hello')?.subject).toBe('hello');
  });

  // ── What must NOT be read as a header ──

  it('leaves an ordinary comment alone', () => {
    expect(parseConventionalComment('This leaks a handle.')).toBeNull();
    expect(parseConventionalComment('')).toBeNull();
  });

  it('does not invent a label that is not one of the nine', () => {
    expect(parseConventionalComment('bikeshed: paint it blue')).toBeNull();
    expect(parseConventionalComment('TODOS: things')).toBeNull();
  });

  /** A label with nothing after it is a label, not a comment: a badge
   *  over an empty body, with the real first line hidden below it. */
  it('rejects a header with no subject', () => {
    expect(parseConventionalComment('issue:')).toBeNull();
    expect(parseConventionalComment('issue:   \n\nthe real text')).toBeNull();
  });

  /** The header is a prefix or it is nothing. Matching mid-body would
   *  badge a comment by a line its reader never treated as a heading. */
  it('does not look past the first line', () => {
    expect(
      parseConventionalComment('Some preamble.\n\nissue: buried')
    ).toBeNull();
  });

  it('does not match a label that is only the start of a word', () => {
    expect(parseConventionalComment('nitpicking: not a label')).toBeNull();
    expect(parseConventionalComment('noted: not a label')).toBeNull();
  });

  it('does not match a label wrapped in markdown emphasis', () => {
    expect(parseConventionalComment('**issue**: bolded')).toBeNull();
  });

  /** Indentation means code or a quote, not a heading. */
  it('does not match an indented line', () => {
    expect(parseConventionalComment('    issue: indented')).toBeNull();
  });
});

describe('formatConventionalComment', () => {
  const base: ConventionalComment = {
    label: 'issue',
    decorations: [],
    subject: 'This leaks a handle.',
    body: '',
  };

  it('writes label, decorations, subject', () => {
    expect(
      formatConventionalComment({ ...base, decorations: ['blocking'] })
    ).toBe('issue (blocking): This leaks a handle.');
  });

  it('omits the parentheses when there are no decorations', () => {
    expect(formatConventionalComment(base)).toBe('issue: This leaks a handle.');
  });

  it('puts a blank line between the header and the discussion', () => {
    expect(formatConventionalComment({ ...base, body: 'Because of X.' })).toBe(
      'issue: This leaks a handle.\n\nBecause of X.'
    );
  });
});

describe('parse(format(x)) round-trips', () => {
  const comment = fc.record({
    label: fc.constantFrom(...CONVENTIONAL_LABELS),
    decorations: fc.array(
      fc.constantFrom('blocking', 'non-blocking', 'if-minor'),
      { maxLength: 3 }
    ),
    // A subject is one line with something on it; leading and trailing
    // space is formatting, not content, and does not survive a round
    // trip through a format that puts the subject after ": ".
    subject: fc
      .string({ minLength: 1 })
      .map((s) => s.replace(/[\r\n]/g, ' ').trim())
      .filter((s) => s.length > 0),
    body: fc.string().map((s) => s.trim()),
  });

  it('gives back exactly what it was handed', () => {
    fc.assert(
      fc.property(comment, (c) => {
        expect(parseConventionalComment(formatConventionalComment(c))).toEqual(
          c
        );
      })
    );
  });
});

describe('bodies that are not conventional comments pass through', () => {
  it('leaves any body without a recognised header untouched', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        // The generator can stumble onto a real header; those are the
        // subject of the round-trip property above, not this one.
        fc.pre(parseConventionalComment(text) === null);
        expect(commentBodyParts(text)).toEqual({
          header: null,
          body: text,
          footer: null,
        });
      })
    );
  });
});

describe('conventionalForSeverity', () => {
  /** Severity is what the diff viewer sorts and colours by; a label is
   *  what the reviewer on the other end reads. Same judgement, two
   *  vocabularies — so the trip out and back has to land where it
   *  started, or a posted comment changes colour on reload. */
  it('round-trips every severity through its label', () => {
    const severities: CommentSeverity[] = ['critical', 'major', 'minor', 'nit'];
    for (const severity of severities) {
      expect(conventionalSeverity(conventionalForSeverity(severity))).toBe(
        severity
      );
    }
  });

  it('says a critical finding blocks the merge', () => {
    expect(conventionalForSeverity('critical')).toEqual({
      label: 'issue',
      decorations: ['blocking'],
    });
  });
});

describe('conventionalSeverity', () => {
  it('reads a blocking decoration as the loudest thing there is', () => {
    expect(
      conventionalSeverity({ label: 'nitpick', decorations: ['blocking'] })
    ).toBe('critical');
  });

  it('ranks the labels', () => {
    expect(conventionalSeverity({ label: 'issue', decorations: [] })).toBe(
      'major'
    );
    expect(conventionalSeverity({ label: 'suggestion', decorations: [] })).toBe(
      'minor'
    );
    expect(conventionalSeverity({ label: 'praise', decorations: [] })).toBe(
      'nit'
    );
  });

  /** Saying a remark does not block is not the same as retracting it. */
  it('does not let non-blocking demote a label', () => {
    expect(
      conventionalSeverity({ label: 'issue', decorations: ['non-blocking'] })
    ).toBe('major');
  });
});

describe('the agent attribution', () => {
  it('signs a body at the end, after a separator', () => {
    expect(withAgentFooter('The point of the comment.')).toBe(
      `The point of the comment.\n\n---\n${AGENT_FOOTER}`
    );
  });

  it('splits back off what it signed', () => {
    expect(splitAgentFooter(withAgentFooter('Body text.'))).toEqual({
      body: 'Body text.',
      footer: AGENT_FOOTER,
    });
  });

  /** Every comment in a thread runs through this, most of them human. */
  it('leaves an unsigned body alone', () => {
    expect(splitAgentFooter('Just a comment.')).toEqual({
      body: 'Just a comment.',
      footer: null,
    });
  });

  it('does not mistake a mention of Kirby in the prose for a signature', () => {
    const text = 'I posted this via Kirby, by hand.';
    expect(splitAgentFooter(text).footer).toBeNull();
  });
});

describe('commentBodyParts', () => {
  it('splits an agent comment into badge, prose and signature', () => {
    const parts = commentBodyParts(
      withAgentFooter(
        'issue (blocking): This leaks a handle.\n\nThe fd is never closed.'
      )
    );
    expect(parts.header).toMatchObject({
      label: 'issue',
      decorations: ['blocking'],
    });
    expect(parts.body).toBe('This leaks a handle.\n\nThe fd is never closed.');
    expect(parts.footer).toBe(AGENT_FOOTER);
  });

  /** The subject is the comment's first sentence, not part of the
   *  badge — dropping it would delete the actual content of a
   *  single-line comment. */
  it('keeps the subject as the body of a header-only comment', () => {
    expect(commentBodyParts('nitpick: Rename this.').body).toBe('Rename this.');
  });

  it('hands back a plain comment unchanged', () => {
    expect(commentBodyParts('Looks good to me.')).toEqual({
      header: null,
      body: 'Looks good to me.',
      footer: null,
    });
  });

  it('reads a human comment written in the same shape', () => {
    expect(commentBodyParts('question: why the retry here?')).toMatchObject({
      header: { label: 'question' },
      body: 'why the retry here?',
      footer: null,
    });
  });
});
