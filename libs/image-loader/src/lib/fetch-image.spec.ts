import { describe, it, expect, vi } from 'vitest';
import { fetchImageBytes } from './fetch-image.js';

function fakeFetch(
  body: Uint8Array,
  init: { status?: number } = {}
): typeof fetch {
  return vi.fn(async () => new Response(body, { status: init.status ?? 200 }));
}

const BYTES = new Uint8Array([1, 2, 3]);

describe('fetchImageBytes', () => {
  it('returns the response bytes', async () => {
    const f = fakeFetch(BYTES);
    const out = await fetchImageBytes(
      'https://example.com/i.png',
      {},
      {
        fetchImpl: f,
      }
    );
    expect([...out]).toEqual([1, 2, 3]);
  });

  it('sends a bearer token to github.com attachment urls', async () => {
    const f = fakeFetch(BYTES);
    await fetchImageBytes(
      'https://github.com/user-attachments/assets/abc',
      { githubToken: 'gh-tok' },
      { fetchImpl: f }
    );
    const headers = new Headers(
      (vi.mocked(f).mock.calls[0][1] as RequestInit).headers
    );
    expect(headers.get('authorization')).toBe('Bearer gh-tok');
  });

  it('sends a bearer token to *.githubusercontent.com', async () => {
    const f = fakeFetch(BYTES);
    await fetchImageBytes(
      'https://private-user-images.githubusercontent.com/1/2.png',
      { githubToken: 'gh-tok' },
      { fetchImpl: f }
    );
    const headers = new Headers(
      (vi.mocked(f).mock.calls[0][1] as RequestInit).headers
    );
    expect(headers.get('authorization')).toBe('Bearer gh-tok');
  });

  it('sends basic PAT auth to dev.azure.com', async () => {
    const f = fakeFetch(BYTES);
    await fetchImageBytes(
      'https://dev.azure.com/org/_apis/git/repositories/r/pullRequests/1/attachments/x.png',
      { azurePat: 'pat123' },
      { fetchImpl: f }
    );
    const headers = new Headers(
      (vi.mocked(f).mock.calls[0][1] as RequestInit).headers
    );
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from(':pat123').toString('base64')}`
    );
  });

  it('sends no auth header to unrelated hosts', async () => {
    const f = fakeFetch(BYTES);
    await fetchImageBytes(
      'https://imgur.example/i.png',
      { githubToken: 'gh-tok', azurePat: 'pat123' },
      { fetchImpl: f }
    );
    const headers = new Headers(
      (vi.mocked(f).mock.calls[0][1] as RequestInit)?.headers
    );
    expect(headers.get('authorization')).toBeNull();
  });

  it('rejects on non-2xx responses', async () => {
    const f = fakeFetch(BYTES, { status: 404 });
    await expect(
      fetchImageBytes('https://example.com/i.png', {}, { fetchImpl: f })
    ).rejects.toThrow(/404/);
  });

  it('rejects bodies above maxBytes', async () => {
    const f = fakeFetch(new Uint8Array(2048));
    await expect(
      fetchImageBytes(
        'https://example.com/i.png',
        {},
        {
          fetchImpl: f,
          maxBytes: 1024,
        }
      )
    ).rejects.toThrow(/too large/i);
  });

  it('rejects non-http(s) urls without calling fetch', async () => {
    const f = fakeFetch(BYTES);
    await expect(
      fetchImageBytes('file:///etc/passwd', {}, { fetchImpl: f })
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
