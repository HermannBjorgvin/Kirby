/**
 * beam client — pair with a host's URL, then dial it for a live connection.
 * Pairing is symmetric (see docs/beam.md): `pair()` also stores the host's
 * own identity in this machine's peer table, exactly as the host stores
 * ours.
 */

import { AuthError, verifyHostSignature, signNonce } from './auth.js';
import { ConnectionRegistry } from './connection-registry.js';
import { createConnection, type PeerConnection } from './connection.js';
import type { HostDescriptor } from './host.js';
import { DESCRIPTOR_PATH, PROTOCOL_VERSION } from './host.js';
import { derivePeerId, type Identity } from './identity.js';
import type { PeerRecord, PeerTable } from './peer-table.js';
import { randomSecret } from './secrets.js';
import { StreamRegistry } from './stream-registry.js';
import { WebSocketTransport, type Transport } from './transport.js';

export async function fetchDescriptor(
  baseUrl: string
): Promise<HostDescriptor> {
  const response = await fetch(new URL(DESCRIPTOR_PATH, baseUrl));
  if (!response.ok)
    throw new Error(`descriptor request failed: ${response.status}`);
  return (await response.json()) as HostDescriptor;
}

export interface PairOptions {
  identity: Identity;
  /** Where the host may dial this machine back; empty if it does not accept
   * connections. */
  endpoints?: string[];
}

export interface PairResult {
  baseUrl: string;
  /** The host, as now stored in this machine's own peer table. */
  peer: PeerRecord;
}

/** Parse the `#token=` fragment out of a `beam serve` pairing URL. */
function parsePairUrl(pairUrl: string): { baseUrl: string; token: string } {
  const url = new URL(pairUrl);
  const prefix = '#token=';
  if (!url.hash.startsWith(prefix))
    throw new Error('pair URL carries no #token= fragment');
  const token = decodeURIComponent(url.hash.slice(prefix.length));
  return {
    baseUrl: `${url.origin}${url.pathname.replace(/\/pair$/, '')}`,
    token,
  };
}

/** Trade a one-time pairing token for the host's identity, and store it —
 * both sides hold each other's public key after this returns. */
export async function pair(
  pairUrl: string,
  peers: PeerTable,
  options: PairOptions
): Promise<PairResult> {
  const { baseUrl, token } = parsePairUrl(pairUrl);
  const descriptor = await fetchDescriptor(baseUrl);
  if (descriptor.protocol !== PROTOCOL_VERSION) {
    throw new Error(
      `host speaks protocol ${descriptor.protocol}, this client speaks ${PROTOCOL_VERSION}`
    );
  }
  const response = await fetch(new URL('/pair', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token,
      publicKeyPem: options.identity.publicKeyPem,
      label: options.identity.label,
      endpoints: options.endpoints ?? [],
    }),
  });
  if (!response.ok)
    throw new Error(
      `pairing failed (${response.status}): ${await response.text()}`
    );
  const body = (await response.json()) as {
    peerId: string;
    label: string;
    publicKeyPem: string;
    endpoints: string[];
  };
  // The id is derived, never asserted (docs/beam.md): a pairing host that
  // claims an id its own key does not derive to — including one already in
  // this table — would otherwise silently replace that record's key with no
  // `--force` gate, indistinguishable from an attacker swapping the key.
  const derivedPeerId = derivePeerId(body.publicKeyPem);
  if (derivedPeerId !== body.peerId) {
    throw new AuthError(
      'host-id-mismatch',
      `host claimed id ${body.peerId} but its public key derives to ${derivedPeerId}`
    );
  }
  const peer = peers.upsert({
    peerId: derivedPeerId,
    label: body.label,
    publicKeyPem: body.publicKeyPem,
    endpoints: body.endpoints,
  });
  return { baseUrl, peer };
}

export interface DialOptions {
  identity: Identity;
  peers: PeerTable;
  registry?: StreamRegistry;
  /** Live connections this dial registers into (A2) — the mailbox flusher
   * looks connections up by peerId regardless of which side dialed, so a
   * dialed connection must land here exactly as an accepted one does on the
   * host side. */
  connections?: ConnectionRegistry;
  transport?: Transport;
}

/**
 * Authenticate to an already-paired host and open the stream connection.
 * The mutual proof happens before any stream can open: this machine signs
 * the host's challenge, and verifies the host's own signature over a fresh
 * nonce against the public key stored at pairing time.
 */
export async function dial(
  baseUrl: string,
  hostPeerId: string,
  options: DialOptions
): Promise<PeerConnection> {
  const peer = options.peers.resolve(hostPeerId);
  if (!peer) throw new Error(`unknown peer: ${hostPeerId}`);
  if (peer.revoked) throw new Error(`peer ${peer.peerId} has been revoked`);

  const challengeRes = await fetch(
    new URL(`/challenge/${options.identity.peerId}`, baseUrl)
  );
  if (!challengeRes.ok)
    throw new Error(`challenge request failed: ${challengeRes.status}`);
  const { challenge } = (await challengeRes.json()) as { challenge: string };

  const clientChallenge = randomSecret(16);
  const signature = signNonce(options.identity.privateKeyPem, challenge);
  const sessionRes = await fetch(new URL('/session', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      peerId: options.identity.peerId,
      challenge,
      signature,
      clientChallenge,
    }),
  });
  if (!sessionRes.ok)
    throw new Error(
      `session request failed (${
        sessionRes.status
      }): ${await sessionRes.text()}`
    );
  const { ticket, hostSignature } = (await sessionRes.json()) as {
    ticket: string;
    hostSignature: string;
  };
  verifyHostSignature(peer.publicKeyPem, clientChallenge, hostSignature);

  const transport = options.transport ?? new WebSocketTransport();
  const wsUrl = new URL(`/ws?ticket=${encodeURIComponent(ticket)}`, baseUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = await transport.connect(wsUrl.toString());

  const connection = createConnection({
    peerId: peer.peerId,
    label: peer.label,
    role: 'initiator',
    socket,
    registry: options.registry ?? new StreamRegistry(),
  });
  (options.connections ?? new ConnectionRegistry()).add(connection);
  options.peers.touch(peer.peerId);
  return connection;
}
