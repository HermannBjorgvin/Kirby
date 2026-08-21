// Auth-aware image download. Comment images live behind the same
// credentials the VCS providers use: GitHub attachments accept the gh
// CLI's OAuth token as a bearer, Azure DevOps attachments accept the
// stored PAT as basic auth. Everything else is fetched anonymously.

export interface ImageAuth {
  githubToken?: string;
  azurePat?: string;
}

export interface FetchImageOptions {
  fetchImpl?: typeof fetch;
  /** Reject bodies larger than this (default 20 MB). */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function authHeaderFor(url: URL, auth: ImageAuth): string | undefined {
  const host = url.hostname;
  if (
    auth.githubToken &&
    (host === 'github.com' ||
      host === 'githubusercontent.com' ||
      host.endsWith('.githubusercontent.com'))
  ) {
    return `Bearer ${auth.githubToken}`;
  }
  if (
    auth.azurePat &&
    (host === 'dev.azure.com' || host.endsWith('.visualstudio.com'))
  ) {
    return `Basic ${Buffer.from(`:${auth.azurePat}`).toString('base64')}`;
  }
  return undefined;
}

export async function fetchImageBytes(
  url: string,
  auth: ImageAuth,
  opts: FetchImageOptions = {}
): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  const headers: Record<string, string> = {};
  const authHeader = authHeaderFor(parsed, auth);
  if (authHeader) headers['authorization'] = authHeader;

  const res = await fetchImpl(url, { headers, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Image fetch failed: HTTP ${res.status} for ${url}`);
  }
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length > maxBytes) {
    throw new Error(
      `Image too large: ${body.length} bytes (limit ${maxBytes}) for ${url}`
    );
  }
  return body;
}
