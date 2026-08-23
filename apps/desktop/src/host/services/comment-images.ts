import { execFile } from 'node:child_process';
import { readConfig } from '@kirby/vcs-core';
import { requireRepo } from './repo.js';
import type { CommentImagePayload } from '../contract.js';

/**
 * Auth-aware download of images embedded in PR comments. Attachments
 * live behind the same credentials the VCS providers use: GitHub
 * accepts the gh CLI's OAuth token as a bearer, Azure DevOps accepts
 * the stored PAT as basic auth. Everything else is fetched anonymously.
 * Results are returned as data URLs so the sandboxed renderer can show
 * them without any network access of its own.
 */

const MAX_BYTES = 20 * 1024 * 1024;
const CACHE_LIMIT = 200;

const cache = new Map<string, Promise<CommentImagePayload | null>>();

let ghToken: Promise<string | null> | null = null;
function getGhToken(): Promise<string | null> {
  ghToken ??= new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
  return ghToken;
}

function isGitHubHost(host: string): boolean {
  return (
    host === 'github.com' ||
    host === 'githubusercontent.com' ||
    host.endsWith('.githubusercontent.com')
  );
}

function isAzureHost(host: string): boolean {
  return host === 'dev.azure.com' || host.endsWith('.visualstudio.com');
}

export interface ImageCredentials {
  githubToken?: string | null;
  azurePat?: string | null;
}

/** Pick the Authorization header for an attachment host (pure). */
export function authHeaderForUrl(
  url: URL,
  creds: ImageCredentials
): string | undefined {
  const host = url.hostname;
  if (isGitHubHost(host) && creds.githubToken) {
    return `Bearer ${creds.githubToken}`;
  }
  if (isAzureHost(host) && creds.azurePat) {
    return `Basic ${Buffer.from(`:${creds.azurePat}`).toString('base64')}`;
  }
  return undefined;
}

async function authHeaderFor(url: URL): Promise<string | undefined> {
  const host = url.hostname;
  const creds: ImageCredentials = {};
  if (isGitHubHost(host)) creds.githubToken = await getGhToken();
  if (isAzureHost(host)) {
    const config = readConfig(requireRepo());
    creds.azurePat = config.vendorAuth?.['pat'];
  }
  return authHeaderForUrl(url, creds);
}

export function sniffContentType(
  bytes: Uint8Array,
  header: string | null
): string {
  if (header && header.startsWith('image/')) return header.split(';')[0];
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45
  ) {
    return 'image/webp';
  }
  if (bytes[0] === 0x3c) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function download(url: string): Promise<CommentImagePayload | null> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const headers: Record<string, string> = {};
  const auth = await authHeaderFor(parsed);
  if (auth) headers['authorization'] = auth;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) {
    throw new Error(`image too large (${bytes.length} bytes)`);
  }
  const contentType = sniffContentType(bytes, res.headers.get('content-type'));
  if (!contentType.startsWith('image/')) {
    throw new Error(`not an image (${contentType})`);
  }
  return {
    dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString(
      'base64'
    )}`,
    contentType,
    bytes: bytes.length,
  };
}

export function fetchCommentImage(
  url: string
): Promise<CommentImagePayload | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = download(url).catch((err: unknown) => {
    cache.delete(url); // allow retry later
    throw err;
  });
  cache.set(url, p);
  if (cache.size > CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  return p;
}

/** Test hook. */
export function resetCommentImageCache(): void {
  cache.clear();
  ghToken = null;
}
