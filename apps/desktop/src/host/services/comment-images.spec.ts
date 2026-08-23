import { describe, it, expect } from 'vitest';
import { authHeaderForUrl, sniffContentType } from './comment-images.js';

describe('authHeaderForUrl', () => {
  const creds = { githubToken: 'gh_tok', azurePat: 'pat123' };

  it('sends the gh token as a bearer to GitHub hosts only', () => {
    expect(
      authHeaderForUrl(
        new URL('https://github.com/user-attachments/x.png'),
        creds
      )
    ).toBe('Bearer gh_tok');
    expect(
      authHeaderForUrl(
        new URL('https://private-user-images.githubusercontent.com/a.png'),
        creds
      )
    ).toBe('Bearer gh_tok');
  });

  it('sends the PAT as basic auth to Azure DevOps hosts', () => {
    const h = authHeaderForUrl(
      new URL(
        'https://dev.azure.com/org/proj/_apis/git/repositories/r/pullRequests/1/attachments/a.png'
      ),
      creds
    );
    expect(h).toBe(`Basic ${Buffer.from(':pat123').toString('base64')}`);
    expect(
      authHeaderForUrl(new URL('https://org.visualstudio.com/x.png'), creds)
    ).toMatch(/^Basic /);
  });

  it('fetches everything else anonymously and never leaks a token', () => {
    expect(
      authHeaderForUrl(new URL('https://example.com/a.png'), creds)
    ).toBeUndefined();
    expect(
      authHeaderForUrl(new URL('https://evil.com/github.com/a.png'), creds)
    ).toBeUndefined();
    expect(
      authHeaderForUrl(new URL('https://github.com/x.png'), {})
    ).toBeUndefined();
  });
});

describe('sniffContentType', () => {
  it('trusts an image/* header and sniffs magic bytes otherwise', () => {
    expect(
      sniffContentType(new Uint8Array([0, 0]), 'image/png; charset=x')
    ).toBe('image/png');
    expect(
      sniffContentType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        'application/octet-stream'
      )
    ).toBe('image/png');
    expect(sniffContentType(new Uint8Array([0xff, 0xd8, 0xff]), null)).toBe(
      'image/jpeg'
    );
    expect(sniffContentType(new Uint8Array([0x47, 0x49, 0x46]), null)).toBe(
      'image/gif'
    );
    expect(sniffContentType(new Uint8Array([0x00, 0x01]), 'text/html')).toBe(
      'application/octet-stream'
    );
  });
});
