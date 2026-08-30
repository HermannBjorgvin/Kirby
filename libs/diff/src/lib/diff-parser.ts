import type { DiffLine } from './types.js';

/** Header lines that carry no content of their own. */
const IGNORED_PREFIXES = ['index ', '--- ', '+++ '];

/** How far through each side of the file the walk has got. */
interface LineCursor {
  oldLine: number;
  newLine: number;
}

/**
 * Split the diff into the lines the parser walks, with the two artefacts of
 * the transport removed.
 */
function normalizeDiffLines(diffText: string): string[] {
  const rawLines = diffText.split('\n');

  // `git diff` output ends with a newline, so splitting leaves a final
  // empty string. An empty line is otherwise read as unchanged context
  // below, which appended a blank row to the last file of every diff —
  // numbered one past the end of the file. Harmless to look at, but it
  // claims a line that does not exist, and comment anchoring resolves
  // against exactly these numbers.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  // Strip any trailing CR — CRLF source files leave \r on every diff
  // line, which when rendered drives wterm's cursor back to column 0
  // mid-row and overlays the next row's content visually (the
  // "&&duction'" / ",d," mangling users reported).
  return rawLines.map((line) =>
    line.endsWith('\r') ? line.slice(0, -1) : line
  );
}

/** The two starting line numbers in `@@ -old,count +new,count @@`. */
function parseHunkHeader(rawLine: string): LineCursor | null {
  const match = rawLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return { oldLine: parseInt(match[1]!, 10), newLine: parseInt(match[2]!, 10) };
}

/**
 * Classify one body line and advance the cursor past it: an addition
 * consumes a line of the new file, a removal one of the old, context both.
 * Anything else — "\ No newline at end of file" and similar noise — is not
 * a row at all.
 */
function parseContentLine(
  rawLine: string,
  cursor: LineCursor
): DiffLine | null {
  if (rawLine.startsWith('+')) {
    return {
      type: 'add',
      content: rawLine.slice(1),
      newLine: cursor.newLine++,
    };
  }
  if (rawLine.startsWith('-')) {
    return {
      type: 'remove',
      content: rawLine.slice(1),
      oldLine: cursor.oldLine++,
    };
  }
  if (rawLine.startsWith(' ') || rawLine === '') {
    return {
      type: 'context',
      // A wholly blank context line has no marker space to strip.
      content: rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine,
      oldLine: cursor.oldLine++,
      newLine: cursor.newLine++,
    };
  }
  return null;
}

/**
 * Parse a unified diff text into per-file diffs.
 */
export function parseUnifiedDiff(diffText: string): Map<string, DiffLine[]> {
  const result = new Map<string, DiffLine[]>();
  let currentFile: string | null = null;
  let lines: DiffLine[] = [];
  const cursor: LineCursor = { oldLine: 0, newLine: 0 };

  for (const rawLine of normalizeDiffLines(diffText)) {
    // New file header: diff --git a/path b/path
    if (rawLine.startsWith('diff --git ')) {
      if (currentFile) {
        result.set(currentFile, lines);
      }
      const match = rawLine.match(/diff --git a\/(.+?) b\/(.+)/);
      currentFile = match ? match[2]! : null;
      lines = [];
      continue;
    }

    if (IGNORED_PREFIXES.some((prefix) => rawLine.startsWith(prefix))) {
      continue;
    }

    // A hunk header is kept as a row even when it does not parse, so the
    // rendered diff still shows the separator it came with.
    if (rawLine.startsWith('@@')) {
      const start = parseHunkHeader(rawLine);
      if (start) {
        cursor.oldLine = start.oldLine;
        cursor.newLine = start.newLine;
      }
      lines.push({ type: 'hunk-header', content: rawLine });
      continue;
    }

    if (!currentFile) continue;

    const line = parseContentLine(rawLine, cursor);
    if (line) lines.push(line);
  }

  // Save last file
  if (currentFile) {
    result.set(currentFile, lines);
  }

  return result;
}
