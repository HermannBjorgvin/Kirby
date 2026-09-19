/**
 * beam mutual authentication — every later connection is proved by a fresh
 * challenge nonce signed by the peer's Ed25519 key. The host verifies the
 * peer's signature *before* consuming the challenge, so a bogus signature
 * cannot burn the legitimate one; it then signs the client's own nonce so
 * the client can verify it is talking to the peer whose key it stored.
 * See docs/beam.md.
 */

import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import type { PeerTable } from './peer-table.js';
import {
  CHALLENGE_TTL_MS,
  SingleUseSecrets,
  TICKET_TTL_MS,
} from './secrets.js';

/** Domain separation for the WebSocket upgrade proof. A caller signs
 * `beam-ws:<ticket>`, never the bare ticket: both this and `/session`'s
 * challenge are otherwise just "this key signed this opaque string", so
 * without a distinguishing prefix a signature captured from one exchange
 * would verify in the other. */
export const WS_PROOF_PREFIX = 'beam-ws:';

export type AuthErrorKind =
  | 'unknown-peer'
  | 'revoked-peer'
  | 'bad-signature'
  | 'stale-challenge'
  | 'spent-ticket'
  | 'host-key-mismatch'
  | 'host-id-mismatch';

export class AuthError extends Error {
  constructor(public readonly kind: AuthErrorKind, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Sign `nonce` with this machine's private key; the base64 answer proves
 * possession of the key without ever exposing it. */
export function signNonce(privateKeyPem: string, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, 'utf8'), privateKeyPem).toString(
    'base64'
  );
}

/** Verify a nonce signature against a public key. Fails closed: malformed
 * base64 or an unusable key is a verification failure, never a throw. */
export function verifySignature(
  publicKeyPem: string,
  nonce: string,
  signatureB64: string
): boolean {
  try {
    const signature = Buffer.from(signatureB64, 'base64');
    return cryptoVerify(
      null,
      Buffer.from(nonce, 'utf8'),
      publicKeyPem,
      signature
    );
  } catch {
    return false;
  }
}

/** Client side of the handshake: verify the host's proof against the public
 * key already stored for it, and abort on mismatch. */
export function verifyHostSignature(
  hostPublicKeyPem: string,
  clientChallenge: string,
  hostSignature: string
): void {
  if (!verifySignature(hostPublicKeyPem, clientChallenge, hostSignature)) {
    throw new AuthError(
      'host-key-mismatch',
      "the host's signature does not verify against its stored public key"
    );
  }
}

export interface SessionProof {
  peerId: string;
  challenge: string;
  signature: string;
  clientChallenge: string;
}

export interface SessionResult {
  ticket: string;
  hostSignature: string;
}

export interface MutualAuthOptions {
  peers: PeerTable;
  /** This machine's own private key, used to sign the client's nonce. */
  privateKeyPem: string;
  now?: () => number;
  challengeTtlMs?: number;
  ticketTtlMs?: number;
}

/** Owns this machine's challenge and ticket pools and drives the mutual
 * proof described in docs/beam.md's HTTP surface (`/challenge`, `/session`). */
export class MutualAuth {
  private readonly peers: PeerTable;
  private readonly privateKeyPem: string;
  private readonly challenges: SingleUseSecrets<undefined>;
  private readonly tickets: SingleUseSecrets<string>;

  constructor(options: MutualAuthOptions) {
    this.peers = options.peers;
    this.privateKeyPem = options.privateKeyPem;
    const now = options.now ?? Date.now;
    this.challenges = new SingleUseSecrets(
      options.challengeTtlMs ?? CHALLENGE_TTL_MS,
      now
    );
    this.tickets = new SingleUseSecrets(
      options.ticketTtlMs ?? TICKET_TTL_MS,
      now
    );
  }

  /** Mint a nonce for a peer to sign (60s TTL by default). */
  issueChallenge(): string {
    return this.challenges.issue(undefined);
  }

  /**
   * Verify the peer's signature over `challenge` *before* consuming it, then
   * sign `clientChallenge` with this machine's own key and issue a
   * single-use ticket. Throws AuthError with a specific, UI-facing kind.
   */
  proveSession(proof: SessionProof): SessionResult {
    const peer = this.peers.get(proof.peerId);
    if (!peer)
      throw new AuthError('unknown-peer', `no such peer: ${proof.peerId}`);
    if (peer.revoked)
      throw new AuthError(
        'revoked-peer',
        `peer ${proof.peerId} has been revoked`
      );
    if (!verifySignature(peer.publicKeyPem, proof.challenge, proof.signature)) {
      throw new AuthError(
        'bad-signature',
        'signature does not verify against the stored public key'
      );
    }
    if (!this.challenges.consume(proof.challenge).valid) {
      throw new AuthError(
        'stale-challenge',
        'challenge was not issued by this host, or has expired'
      );
    }
    const ticket = this.tickets.issue(proof.peerId);
    return {
      ticket,
      hostSignature: signNonce(this.privateKeyPem, proof.clientChallenge),
    };
  }

  /**
   * The peerId a ticket was issued for, without spending it; null if the
   * ticket is unknown, expired or already used.
   *
   * The WS upgrade verifies the caller's proof *before* consuming the
   * ticket, so a bogus proof cannot burn the legitimate client's — the
   * same rule `proveSession` applies to the challenge. The peerId has to
   * come from the ticket rather than from the caller, or an attacker
   * would get to choose which key their own proof is checked against.
   */
  peekTicket(ticket: string): string | null {
    const result = this.tickets.peek(ticket);
    return result.valid ? result.payload : null;
  }

  /** Consume a ticket, returning the peerId it was issued for. */
  consumeTicket(ticket: string): string {
    const result = this.tickets.consume(ticket);
    if (!result.valid)
      throw new AuthError(
        'spent-ticket',
        'ticket is invalid, expired, or already used'
      );
    return result.payload;
  }
}
