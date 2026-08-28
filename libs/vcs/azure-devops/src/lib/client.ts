import { logNetwork } from '@kirby/logger';

/** Everything needed to address one repository's REST API. */
export interface AdoConfig {
  org: string;
  project: string;
  repo: string;
  pat: string;
}

export function authHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

export function baseUrl(config: AdoConfig): string {
  return `https://dev.azure.com/${config.org}/${config.project}/_apis/git/repositories/${config.repo}`;
}

/**
 * fetch wrapper that emits one debug-level log per request +
 * response. URLs are passed through verbatim (they don't carry the
 * PAT — that lives in the Authorization header which is never
 * logged). Response bodies are NOT included; only status + size +
 * (optional) caller-supplied summary. Gated behind
 * `KIRBY_LOG_LEVEL=debug` so day-to-day runs stay quiet.
 */
export async function tracedFetch(
  context: string,
  url: string,
  init?: RequestInit & { bodyForLog?: unknown }
): Promise<Response> {
  const startedAt = Date.now();
  const method = (init?.method ?? 'GET').toUpperCase();
  logNetwork('ado.network', `→ ${method} ${url}`, {
    body: init?.bodyForLog,
  });
  try {
    const res = await fetch(url, init);
    const durationMs = Date.now() - startedAt;
    logNetwork(
      'ado.network',
      `← ${res.status} ${method} ${url} (${durationMs}ms)`,
      {
        ok: res.ok,
        statusText: res.statusText,
        context,
      }
    );
    return res;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logNetwork(
      'ado.network',
      `× ${method} ${url} (${durationMs}ms) — fetch failed`,
      {
        context,
        error: err instanceof Error ? err.message : String(err),
      }
    );
    throw err;
  }
}
