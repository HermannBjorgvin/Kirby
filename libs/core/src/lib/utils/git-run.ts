import { spawn } from 'node:child_process';

/**
 * Running git for its output, without a cliff.
 *
 * `execFile` buffers stdout into a fixed allocation and *rejects* the
 * whole call the moment the command writes one byte more than
 * `maxBuffer` — the caller gets no output at all, only
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` ("stdout maxBuffer length
 * exceeded"). For a diff that is the wrong failure: whole-file context
 * (`-U99999`) makes a patch as big as the files it touches, so a single
 * generated file in a worktree could take the entire tab down with it.
 *
 * This streams instead, and treats the ceiling as a *stop*, not an
 * error: reading ends at `maxBytes`, the child is killed, and the
 * caller is handed what arrived plus `truncated: true` so it can say so
 * rather than throw. A command that fails for a real reason still
 * rejects, with git's own stderr as the message.
 */

/** Enough of git's complaint to be diagnostic; it is never the payload. */
const MAX_STDERR_BYTES = 64 * 1024;

export interface GitOutput {
  text: string;
  /** The ceiling was reached: `text` is a prefix of what git had to say. */
  truncated: boolean;
}

export function runGit(
  args: readonly string[],
  opts: { cwd?: string; maxBytes: number }
): Promise<GitOutput> {
  return new Promise<GitOutput>((resolve, reject) => {
    const child = spawn('git', [...args], {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let size = 0;
    let errSize = 0;
    let truncated = false;
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return;
      const room = opts.maxBytes - size;
      // Strictly greater: output that lands exactly on the ceiling is
      // whole, and calling it truncated makes the caller throw away its
      // last complete file for nothing.
      if (chunk.byteLength > room) {
        chunks.push(chunk.subarray(0, Math.max(room, 0)));
        size = opts.maxBytes;
        truncated = true;
        child.kill('SIGKILL');
        return;
      }
      chunks.push(chunk);
      size += chunk.byteLength;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (errSize >= MAX_STDERR_BYTES) return;
      errChunks.push(chunk);
      errSize += chunk.byteLength;
    });

    // A pipe error after the SIGKILL above, or an EIO, is an unhandled
    // `'error'` event — which throws out of the emitter, in the Electron
    // main process, where nothing catches it. `'close'` still arrives
    // and settles the promise; these listeners exist so the throw does
    // not happen first.
    child.stdout.on('error', () => undefined);
    child.stderr.on('error', () => undefined);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      finish(() => {
        const text = Buffer.concat(chunks).toString('utf8');
        // A non-zero exit after we killed it is our own doing.
        if (truncated || code === 0) resolve({ text, truncated });
        else {
          const why = Buffer.concat(errChunks).toString('utf8').trim();
          reject(
            new Error(
              `git ${args[0]} failed (exit ${String(code)})${
                why ? `: ${why}` : ''
              }`
            )
          );
        }
      });
    });
  });
}

/** `runGit` for a command whose output is a line or two (a SHA, a ref). */
export async function gitLine(
  args: readonly string[],
  opts: { cwd?: string } = {}
): Promise<string> {
  const { text } = await runGit(args, { ...opts, maxBytes: 64 * 1024 });
  return text.trim();
}
