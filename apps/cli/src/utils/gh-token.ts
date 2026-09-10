import { execFile } from 'node:child_process';

let cached: Promise<string | null> | null = null;

/**
 * The gh CLI's OAuth token, for downloading private GitHub attachment
 * images. Cached for the process lifetime; resolves null when gh is
 * missing or logged out (images then fetch anonymously and private
 * ones fall back to markdown text).
 */
export function getGhToken(): Promise<string | null> {
  cached ??= new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
  return cached;
}
