import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MutualAuth,
  signNonce,
  verifyHostSignature,
  verifySignature,
} from './auth.js';
import type { AuthError } from './auth.js';
import { derivePeerId } from './identity.js';
import { PeerTable } from './peer-table.js';

/** Run `fn`, returning the error it threw. Keeps `.kind` assertions out of
 * the `catch` block, which vitest's no-conditional-expect rule flags. */
function captureError(fn: () => unknown): AuthError {
  try {
    fn();
  } catch (error) {
    return error as AuthError;
  }
  throw new Error('expected fn to throw');
}

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  };
}

describe('signNonce / verifySignature', () => {
  it('a signature made with the matching private key verifies', () => {
    const { publicKeyPem, privateKeyPem } = keyPair();
    const signature = signNonce(privateKeyPem, 'nonce-1');
    expect(verifySignature(publicKeyPem, 'nonce-1', signature)).toBe(true);
  });

  it('a signature does not verify against a different nonce', () => {
    const { publicKeyPem, privateKeyPem } = keyPair();
    const signature = signNonce(privateKeyPem, 'nonce-1');
    expect(verifySignature(publicKeyPem, 'nonce-2', signature)).toBe(false);
  });

  it('a signature does not verify against a different key', () => {
    const a = keyPair();
    const b = keyPair();
    const signature = signNonce(a.privateKeyPem, 'nonce-1');
    expect(verifySignature(b.publicKeyPem, 'nonce-1', signature)).toBe(false);
  });

  it('malformed base64 fails closed rather than throwing', () => {
    const { publicKeyPem } = keyPair();
    expect(
      verifySignature(
        publicKeyPem,
        'nonce',
        'not valid base64 signature bytes!!'
      )
    ).toBe(false);
  });
});

describe('MutualAuth', () => {
  let dir: string;
  let peers: PeerTable;
  let host: ReturnType<typeof keyPair>;
  let client: ReturnType<typeof keyPair>;
  let clientPeerId: string;
  let auth: MutualAuth;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beam-auth-'));
    peers = new PeerTable(dir);
    host = keyPair();
    client = keyPair();
    clientPeerId = derivePeerId(client.publicKeyPem);
    peers.upsert({
      peerId: clientPeerId,
      label: 'client',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    auth = new MutualAuth({ peers, privateKeyPem: host.privateKeyPem });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function proveWith(
    overrides: { peerId?: string; challenge?: string; signature?: string } = {}
  ) {
    const challenge = overrides.challenge ?? auth.issueChallenge();
    const signature =
      overrides.signature ?? signNonce(client.privateKeyPem, challenge);
    return auth.proveSession({
      peerId: overrides.peerId ?? clientPeerId,
      challenge,
      signature,
      clientChallenge: 'client-nonce',
    });
  }

  it('a valid signature authenticates and returns a ticket plus a host signature', () => {
    const result = proveWith();
    expect(typeof result.ticket).toBe('string');
    expect(
      verifySignature(host.publicKeyPem, 'client-nonce', result.hostSignature)
    ).toBe(true);
  });

  it('rejects an unknown peer', () => {
    const error = captureError(() => proveWith({ peerId: 'not-a-real-peer' }));
    expect(error.kind).toBe('unknown-peer');
  });

  it('rejects a revoked peer', () => {
    peers.revoke(clientPeerId);
    const error = captureError(() => proveWith());
    expect(error.kind).toBe('revoked-peer');
  });

  it('rejects a tampered signature, and the legitimate challenge still works afterward', () => {
    const challenge = auth.issueChallenge();
    const tampered = signNonce(client.privateKeyPem, 'a-different-nonce');
    const error = captureError(() =>
      proveWith({ challenge, signature: tampered })
    );
    expect(error.kind).toBe('bad-signature');
    // The bogus signature must not have burned the legitimate challenge.
    const good = signNonce(client.privateKeyPem, challenge);
    const result = auth.proveSession({
      peerId: clientPeerId,
      challenge,
      signature: good,
      clientChallenge: 'x',
    });
    expect(typeof result.ticket).toBe('string');
  });

  it('rejects a challenge the host never issued', () => {
    const forged = 'never-issued-challenge';
    const signature = signNonce(client.privateKeyPem, forged);
    const error = captureError(() =>
      proveWith({ challenge: forged, signature })
    );
    expect(error.kind).toBe('stale-challenge');
  });

  it('rejects a stale (expired) challenge', () => {
    let now = 0;
    const timedAuth = new MutualAuth({
      peers,
      privateKeyPem: host.privateKeyPem,
      now: () => now,
      challengeTtlMs: 100,
    });
    const challenge = timedAuth.issueChallenge();
    now = 200;
    const signature = signNonce(client.privateKeyPem, challenge);
    const error = captureError(() =>
      timedAuth.proveSession({
        peerId: clientPeerId,
        challenge,
        signature,
        clientChallenge: 'x',
      })
    );
    expect(error.kind).toBe('stale-challenge');
  });

  it('a ticket is single-use', () => {
    const { ticket } = proveWith();
    expect(auth.consumeTicket(ticket)).toBe(clientPeerId);
    const error = captureError(() => auth.consumeTicket(ticket));
    expect(error.kind).toBe('spent-ticket');
  });
});

describe('verifyHostSignature (client side)', () => {
  it('accepts a signature that verifies against the stored host key', () => {
    const host = keyPair();
    const signature = signNonce(host.privateKeyPem, 'nonce');
    expect(() =>
      verifyHostSignature(host.publicKeyPem, 'nonce', signature)
    ).not.toThrow();
  });

  it('rejects a host whose returned signature does not verify against the stored key', () => {
    const host = keyPair();
    const impostor = keyPair();
    const signature = signNonce(impostor.privateKeyPem, 'nonce');
    const error = captureError(() =>
      verifyHostSignature(host.publicKeyPem, 'nonce', signature)
    );
    expect(error.kind).toBe('host-key-mismatch');
  });
});
