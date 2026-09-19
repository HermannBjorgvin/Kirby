import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signNonce, verifySignature } from './auth.js';
import { derivePeerId, loadOrCreateIdentity } from './identity.js';
import { PeerTable } from './peer-table.js';
import { Host } from './host.js';

let dir: string;
let host: Host;

interface ClientIdentity {
  peerId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

function clientKeyPair(): ClientIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const privateKeyPem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  return { peerId: derivePeerId(publicKeyPem), publicKeyPem, privateKeyPem };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-host-'));
});

afterEach(async () => {
  await host?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function startHost(
  overrides: Partial<{ hostname: string; log: (m: string) => void }> = {}
): Promise<Host> {
  const identity = loadOrCreateIdentity(dir, { hostname: () => 'host-box' });
  const peers = new PeerTable(dir);
  host = new Host({ identity, peers, port: 0, ...overrides });
  await host.listen();
  return host;
}

describe('Host HTTP surface', () => {
  it('defaults to binding loopback', async () => {
    const h = await startHost();
    expect(h.hostname).toBe('127.0.0.1');
  });

  it('logs when told to bind a non-loopback interface', async () => {
    const logs: string[] = [];
    await startHost({ hostname: '0.0.0.0', log: (m) => logs.push(m) });
    expect(logs.some((m) => m.includes('0.0.0.0'))).toBe(true);
  });

  it('serves its own descriptor', async () => {
    const h = await startHost();
    const res = await fetch(`${h.baseUrl}/.well-known/beam/host`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      peerId: string;
      label: string;
      protocol: number;
      capabilities: string[];
    };
    expect(body.peerId).toBe(h.identity.peerId);
    expect(body.label).toBe('host-box');
    expect(Array.isArray(body.capabilities)).toBe(true);
  });

  it("pairing registers the caller and returns this host's own identity, symmetrically", async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const token = h.issuePairingToken();

    const res = await fetch(`${h.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        publicKeyPem: client.publicKeyPem,
        label: 'laptop',
        endpoints: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      peerId: string;
      label: string;
      publicKeyPem: string;
      endpoints: string[];
    };
    expect(body.peerId).toBe(h.identity.peerId);
    expect(body.publicKeyPem).toBe(h.identity.publicKeyPem);

    const stored = h.peers.get(client.peerId);
    expect(stored?.label).toBe('laptop');
    expect(stored?.publicKeyPem).toBe(client.publicKeyPem);
  });

  it('setEndpoints changes what a pairing response advertises, without a restart', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const before = await fetch(`${h.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: h.issuePairingToken(),
        publicKeyPem: client.publicKeyPem,
        label: 'laptop',
        endpoints: [],
      }),
    });
    expect(
      ((await before.json()) as { endpoints: string[] }).endpoints
    ).toEqual([]);

    h.setEndpoints([h.baseUrl]);
    const after = await fetch(`${h.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: h.issuePairingToken(),
        publicKeyPem: client.publicKeyPem,
        label: 'laptop',
        endpoints: [],
      }),
    });
    expect(((await after.json()) as { endpoints: string[] }).endpoints).toEqual(
      [h.baseUrl]
    );
  });

  it('a pairing token works exactly once', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const token = h.issuePairingToken();
    const pair = () =>
      fetch(`${h.baseUrl}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          publicKeyPem: client.publicKeyPem,
          label: 'laptop',
          endpoints: [],
        }),
      });
    expect((await pair()).status).toBe(201);
    expect((await pair()).status).toBe(401);
  });

  it('a re-pair that would change a stored peer is refused without replace', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const post = (body: Record<string, unknown>) =>
      fetch(`${h.baseUrl}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: h.issuePairingToken(),
          publicKeyPem: client.publicKeyPem,
          label: 'laptop',
          ...body,
        }),
      });

    expect((await post({ endpoints: ['http://real:9000'] })).status).toBe(201);
    // A public key is not a secret. Anyone holding a live pairing token
    // and this peer's key could otherwise point `endpoints` — where the
    // mailbox flusher dials — anywhere they liked.
    const hijack = await post({ endpoints: ['http://attacker:1'] });
    expect(hijack.status).toBe(409);
    expect(await hijack.json()).toEqual({ error: 'already-paired' });
    expect(h.peers.get(client.peerId)?.endpoints).toEqual(['http://real:9000']);

    // Re-pairing with what is already stored is not a change, so it is not
    // a conflict; and an explicit replace still goes through.
    expect((await post({ endpoints: ['http://real:9000'] })).status).toBe(201);
    expect(
      (await post({ endpoints: ['http://moved:9100'], replace: true })).status
    ).toBe(201);
    expect(h.peers.get(client.peerId)?.endpoints).toEqual([
      'http://moved:9100',
    ]);
  });

  it('a refused re-pair still spends its token, so the endpoint is no oracle', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const post = (token: string, endpoints: string[]) =>
      fetch(`${h.baseUrl}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          publicKeyPem: client.publicKeyPem,
          label: 'laptop',
          endpoints,
        }),
      });
    expect(
      (await post(h.issuePairingToken(), ['http://real:9000'])).status
    ).toBe(201);
    const token = h.issuePairingToken();
    expect((await post(token, ['http://attacker:1'])).status).toBe(409);
    expect((await post(token, ['http://attacker:1'])).status).toBe(401);
  });

  it('rejects a body over the 64 KiB cap', async () => {
    const h = await startHost();
    const res = await fetch(`${h.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'x', publicKeyPem: 'x'.repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it('the full mutual-auth round trip: challenge, session, and a ws upgrade with the ticket', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });

    const challengeRes = await fetch(`${h.baseUrl}/challenge/${client.peerId}`);
    expect(challengeRes.status).toBe(200);
    const { challenge } = (await challengeRes.json()) as { challenge: string };

    const signature = signNonce(client.privateKeyPem, challenge);
    const sessionRes = await fetch(`${h.baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        peerId: client.peerId,
        challenge,
        signature,
        clientChallenge: 'nonce-x',
      }),
    });
    expect(sessionRes.status).toBe(200);
    const { ticket, hostSignature } = (await sessionRes.json()) as {
      ticket: string;
      hostSignature: string;
    };
    expect(
      verifySignature(h.identity.publicKeyPem, 'nonce-x', hostSignature)
    ).toBe(true);

    const wsUrl = `ws://${h.hostname}:${h.port}/ws?ticket=${encodeURIComponent(
      ticket
    )}`;
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    expect(h.connections.get(client.peerId)).toBeDefined();
    socket.close();
  });

  it('GET /challenge/:peerId 404s for an unknown peer', async () => {
    const h = await startHost();
    const res = await fetch(`${h.baseUrl}/challenge/nope`);
    expect(res.status).toBe(404);
  });

  it('POST /session distinguishes unknown-peer, revoked-peer, bad-signature and stale-challenge', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });

    const session = (body: Record<string, unknown>) =>
      fetch(`${h.baseUrl}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const unknown = await session({
      peerId: 'nope',
      challenge: 'x',
      signature: 'x',
      clientChallenge: 'x',
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toBe(
      'unknown-peer'
    );

    const forgedChallenge = 'never-issued-by-this-host';
    const validSignatureOverForgedChallenge = signNonce(
      client.privateKeyPem,
      forgedChallenge
    );
    const staleRes = await session({
      peerId: client.peerId,
      challenge: forgedChallenge,
      signature: validSignatureOverForgedChallenge,
      clientChallenge: 'x',
    });
    expect(staleRes.status).toBe(401);
    expect(((await staleRes.json()) as { error: string }).error).toBe(
      'stale-challenge'
    );

    const { challenge } = (await (
      await fetch(`${h.baseUrl}/challenge/${client.peerId}`)
    ).json()) as {
      challenge: string;
    };
    const badSig = await session({
      peerId: client.peerId,
      challenge,
      signature: 'not-a-real-signature',
      clientChallenge: 'x',
    });
    expect(badSig.status).toBe(401);
    expect(((await badSig.json()) as { error: string }).error).toBe(
      'bad-signature'
    );

    // Fetch a legitimate challenge *before* revoking, so this exercises
    // /session's own revocation check independently of /challenge's — the
    // window A5 closes is exactly a peer revoked between challenge issuance
    // and session completion (e.g. inside a stale ticket's 30s life).
    const { challenge: challenge2 } = (await (
      await fetch(`${h.baseUrl}/challenge/${client.peerId}`)
    ).json()) as {
      challenge: string;
    };
    const signature2 = signNonce(client.privateKeyPem, challenge2);
    h.peers.revoke(client.peerId);
    const revokedRes = await session({
      peerId: client.peerId,
      challenge: challenge2,
      signature: signature2,
      clientChallenge: 'x',
    });
    expect(revokedRes.status).toBe(403);
    expect(((await revokedRes.json()) as { error: string }).error).toBe(
      'revoked-peer'
    );
  });

  it('A5: /challenge/:peerId also 403s a revoked peer, not just /session', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    h.peers.revoke(client.peerId);
    const res = await fetch(`${h.baseUrl}/challenge/${client.peerId}`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      'revoked-peer'
    );
  });

  it('A5: revoking a peer with a live connection drops it', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    const { challenge } = (await (
      await fetch(`${h.baseUrl}/challenge/${client.peerId}`)
    ).json()) as { challenge: string };
    const signature = signNonce(client.privateKeyPem, challenge);
    const sessionRes = await fetch(`${h.baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        peerId: client.peerId,
        challenge,
        signature,
        clientChallenge: 'x',
      }),
    });
    const { ticket } = (await sessionRes.json()) as { ticket: string };
    const wsUrl = `ws://${h.hostname}:${h.port}/ws?ticket=${encodeURIComponent(
      ticket
    )}`;
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    expect(h.connections.get(client.peerId)).toBeDefined();

    const closed = new Promise<void>((resolve) =>
      socket.once('close', resolve)
    );
    h.revoke(client.peerId);
    await closed;
    expect(h.connections.get(client.peerId)).toBeUndefined();
  });

  it('A5: revoking inside the ticket window still blocks the upgrade', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    const { challenge } = (await (
      await fetch(`${h.baseUrl}/challenge/${client.peerId}`)
    ).json()) as { challenge: string };
    const signature = signNonce(client.privateKeyPem, challenge);
    const sessionRes = await fetch(`${h.baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        peerId: client.peerId,
        challenge,
        signature,
        clientChallenge: 'x',
      }),
    });
    const { ticket } = (await sessionRes.json()) as { ticket: string };
    // Revoke *after* the ticket was minted but *before* it is redeemed — the
    // exact window a ticket alone cannot close.
    h.peers.revoke(client.peerId);
    const wsUrl = `ws://${h.hostname}:${h.port}/ws?ticket=${encodeURIComponent(
      ticket
    )}`;
    const socket = new WebSocket(wsUrl);
    const outcome = await new Promise<'open' | 'error'>((resolve) => {
      socket.once('open', () => resolve('open'));
      socket.once('error', () => resolve('error'));
    });
    expect(outcome).toBe('error');
  });

  it('POST /rtc reports webrtc as unsupported in this phase', async () => {
    const h = await startHost();
    const res = await fetch(`${h.baseUrl}/rtc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: 'whatever', sdp: 'x', type: 'offer' }),
    });
    expect(res.status).toBe(501);
  });

  it('D3 audit: a raw upgrade socket that errors after a rejection does not crash the node', async () => {
    const h = await startHost();
    const fakeSocket = new EventEmitter();
    Object.assign(fakeSocket, { write: () => true, destroy: () => undefined });
    const req = { url: '/ws?ticket=not-a-real-ticket' } as IncomingMessage;

    const withPrivateAccess = h as unknown as {
      handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void;
    };
    // The bad ticket takes the write-401-then-destroy rejection path.
    expect(() =>
      withPrivateAccess.handleUpgrade(
        req,
        fakeSocket as unknown as Socket,
        Buffer.alloc(0)
      )
    ).not.toThrow();
    // A client resetting the connection right as we reject it must not
    // surface as an unhandled 'error' — same class of bug as D3's stdin
    // write, and an EventEmitter with nobody listening throws synchronously
    // when one fires.
    expect(() =>
      fakeSocket.emit('error', new Error('ECONNRESET'))
    ).not.toThrow();
  });
});
