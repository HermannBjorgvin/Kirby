/**
 * beam host — the JSON-over-HTTP routes from docs/beam.md's auth surface.
 * Split out of host.ts so the server's lifecycle and the route bodies stay
 * independently readable; every function here takes its dependencies
 * explicitly rather than reaching into a Host instance.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthError, type MutualAuth } from './auth.js';
import { readJsonBody, sendJson, BodyTooLargeError } from './http-json.js';
import { derivePeerId, type Identity } from './identity.js';
import type { PeerTable } from './peer-table.js';
import type { SingleUseSecrets } from './secrets.js';

export const DESCRIPTOR_PATH = '/.well-known/beam/host';
export const PROTOCOL_VERSION = 1;

export interface HostDescriptor {
  peerId: string;
  label: string;
  protocol: number;
  capabilities: string[];
}

const AUTH_STATUS: Record<AuthError['kind'], number> = {
  'unknown-peer': 404,
  'revoked-peer': 403,
  'bad-signature': 401,
  'stale-challenge': 401,
  'spent-ticket': 401,
  'host-key-mismatch': 401, // never raised host-side; listed for completeness.
};

export interface RouteContext {
  identity: Identity;
  peers: PeerTable;
  auth: MutualAuth;
  pairingTokens: SingleUseSecrets<undefined>;
  endpoints: string[];
  capabilities: string[];
  log: (message: string) => void;
}

async function readBody(
  req: IncomingMessage,
  res: ServerResponse
): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonBody(req);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendJson(res, 413, { error: error.message });
    } else {
      sendJson(res, 400, { error: 'malformed JSON body' });
    }
    return null;
  }
}

export function handleDescriptor(ctx: RouteContext, res: ServerResponse): void {
  const descriptor: HostDescriptor = {
    peerId: ctx.identity.peerId,
    label: ctx.identity.label,
    protocol: PROTOCOL_VERSION,
    capabilities: ctx.capabilities,
  };
  sendJson(res, 200, descriptor);
}

export async function handlePair(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readBody(req, res);
  if (!body) return;
  const { token, publicKeyPem, label, endpoints } = body as {
    token?: unknown;
    publicKeyPem?: unknown;
    label?: unknown;
    endpoints?: unknown;
  };
  if (
    typeof token !== 'string' ||
    typeof publicKeyPem !== 'string' ||
    typeof label !== 'string'
  ) {
    sendJson(res, 400, {
      error: 'token, publicKeyPem, and label are required',
    });
    return;
  }
  if (!ctx.pairingTokens.consume(token).valid) {
    sendJson(res, 401, {
      error: 'invalid, expired, or already-used pairing token',
    });
    return;
  }
  const peerId = ctx.peers.upsert({
    peerId: derivePeerId(publicKeyPem),
    label,
    publicKeyPem,
    endpoints: Array.isArray(endpoints)
      ? endpoints.filter((e): e is string => typeof e === 'string')
      : [],
  }).peerId;
  ctx.log(`paired with ${peerId}`);
  sendJson(res, 201, {
    peerId: ctx.identity.peerId,
    label: ctx.identity.label,
    publicKeyPem: ctx.identity.publicKeyPem,
    endpoints: ctx.endpoints,
    protocol: PROTOCOL_VERSION,
  });
}

export function handleChallenge(
  ctx: RouteContext,
  peerId: string,
  res: ServerResponse
): void {
  if (!ctx.peers.get(peerId)) {
    sendJson(res, 404, { error: 'unknown-peer' });
    return;
  }
  sendJson(res, 200, { challenge: ctx.auth.issueChallenge() });
}

export async function handleSession(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readBody(req, res);
  if (!body) return;
  const { peerId, challenge, signature, clientChallenge } = body as Record<
    string,
    unknown
  >;
  if (
    typeof peerId !== 'string' ||
    typeof challenge !== 'string' ||
    typeof signature !== 'string' ||
    typeof clientChallenge !== 'string'
  ) {
    sendJson(res, 400, {
      error: 'peerId, challenge, signature, and clientChallenge are required',
    });
    return;
  }
  try {
    const result = ctx.auth.proveSession({
      peerId,
      challenge,
      signature,
      clientChallenge,
    });
    ctx.peers.touch(peerId);
    sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof AuthError) {
      sendJson(res, AUTH_STATUS[error.kind], { error: error.kind });
      return;
    }
    throw error;
  }
}

export function handleRtc(res: ServerResponse): void {
  sendJson(res, 501, { error: 'this host was built without WebRTC support' });
}
