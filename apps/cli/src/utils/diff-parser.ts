export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk-header';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface FileDiff {
  filename: string;
  lines: DiffLine[];
}

/**
 * Parse a unified diff text into per-file diffs.
 */
export function parseUnifiedDiff(diffText: string): Map<string, DiffLine[]> {
  const result = new Map<string, DiffLine[]>();
  let currentFile: string | null = null;
  let lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of diffText.split('\n')) {
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

    // Skip index, --- and +++ lines
    if (
      rawLine.startsWith('index ') ||
      rawLine.startsWith('--- ') ||
      rawLine.startsWith('+++ ')
    ) {
      continue;
    }

    // Hunk header: @@ -old,count +new,count @@
    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1]!, 10);
        newLine = parseInt(match[2]!, 10);
      }
      lines.push({ type: 'hunk-header', content: rawLine });
      continue;
    }

    if (!currentFile) continue;

    if (rawLine.startsWith('+')) {
      lines.push({
        type: 'add',
        content: rawLine.slice(1),
        newLine: newLine++,
      });
    } else if (rawLine.startsWith('-')) {
      lines.push({
        type: 'remove',
        content: rawLine.slice(1),
        oldLine: oldLine++,
      });
    } else if (rawLine.startsWith(' ') || rawLine === '') {
      lines.push({
        type: 'context',
        content: rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
    // Skip "\ No newline at end of file" and other noise
  }

  // Save last file
  if (currentFile) {
    result.set(currentFile, lines);
  }

  return result;
}
