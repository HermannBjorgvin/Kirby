/**
 * beam host — the machine-resident half of pairing and streaming: a
 * node:http server for the auth surface, a `ws` WebSocket server for the
 * stream connection. Payload never travels over HTTP. See docs/beam.md.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import { AuthError, MutualAuth } from './auth.js';
import { ConnectionRegistry } from './connection-registry.js';
import { createConnection } from './connection.js';
import { BodyTooLargeError, readJsonBody, sendJson } from './http-json.js';
import { derivePeerId, type Identity } from './identity.js';
import type { PeerTable } from './peer-table.js';
import { PAIRING_TOKEN_TTL_MS, SingleUseSecrets } from './secrets.js';
import { StreamRegistry } from './stream-registry.js';
import { wrapWebSocket } from './transport.js';

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

export interface HostOptions {
  identity: Identity;
  peers: PeerTable;
  registry?: StreamRegistry;
  connections?: ConnectionRegistry;
  /** Default '127.0.0.1'. Any other value is a deliberate, logged choice. */
  hostname?: string;
  /** Default 0 (OS-assigned ephemeral port). */
  port?: number;
  /** Where peers may dial this machine back; told to a pairing caller. */
  endpoints?: string[];
  capabilities?: string[];
  now?: () => number;
  log?: (message: string) => void;
}

export class Host {
  readonly identity: Identity;
  readonly peers: PeerTable;
  readonly registry: StreamRegistry;
  readonly connections: ConnectionRegistry;

  private readonly hostnameOption: string;
  private readonly portOption: number;
  private readonly endpoints: string[];
  private readonly capabilities: string[];
  private readonly log: (message: string) => void;
  private readonly auth: MutualAuth;
  private readonly pairingTokens: SingleUseSecrets<undefined>;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;

  constructor(options: HostOptions) {
    this.identity = options.identity;
    this.peers = options.peers;
    this.registry = options.registry ?? new StreamRegistry();
    this.connections = options.connections ?? new ConnectionRegistry();
    this.hostnameOption = options.hostname ?? '127.0.0.1';
    this.portOption = options.port ?? 0;
    this.endpoints = options.endpoints ?? [];
    this.capabilities = options.capabilities ?? ['streams'];
    this.log = options.log ?? ((message) => console.log(`[beam] ${message}`));
    this.pairingTokens = new SingleUseSecrets(
      PAIRING_TOKEN_TTL_MS,
      options.now
    );
    this.auth = new MutualAuth({
      peers: this.peers,
      privateKeyPem: this.identity.privateKeyPem,
      now: options.now,
    });
  }

  get hostname(): string {
    return this.hostnameOption;
  }

  get port(): number {
    const address = this.server?.address();
    if (!address || typeof address === 'string')
      throw new Error('host is not listening');
    return address.port;
  }

  get baseUrl(): string {
    return `http://${this.hostname}:${this.port}`;
  }

  /** Mint a bare one-time pairing token (10 min TTL). */
  issuePairingToken(): string {
    return this.pairingTokens.issue(undefined);
  }

  /** Mint a token plus the ready-to-share pair URL carrying it in the hash,
   * which keeps it out of request lines, proxy logs, and Referer headers. */
  issuePairingUrl(): { token: string; url: string } {
    const token = this.issuePairingToken();
    return { token, url: `${this.baseUrl}/pair#token=${token}` };
  }

  listen(): Promise<void> {
    if (
      this.hostnameOption !== '127.0.0.1' &&
      this.hostnameOption !== 'localhost'
    ) {
      this.log(
        `binding non-loopback interface ${this.hostnameOption} — this exposes the node to that network`
      );
    }
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch(() =>
        sendJson(res, 500, { error: 'internal error' })
      );
    });
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) =>
      this.handleUpgrade(req, socket as Socket, head)
    );
    return new Promise((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.portOption, this.hostnameOption, () =>
        resolve()
      );
    });
  }

  close(): Promise<void> {
    for (const connection of this.connections.list()) connection.close();
    this.wss?.close();
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (req.method === 'GET' && url.pathname === DESCRIPTOR_PATH)
      return this.handleDescriptor(res);
    if (req.method === 'POST' && url.pathname === '/pair')
      return this.handlePair(req, res);
    if (req.method === 'GET' && url.pathname.startsWith('/challenge/')) {
      return this.handleChallenge(
        url.pathname.slice('/challenge/'.length),
        res
      );
    }
    if (req.method === 'POST' && url.pathname === '/session')
      return this.handleSession(req, res);
    if (req.method === 'POST' && url.pathname === '/rtc')
      return this.handleRtc(res);
    sendJson(res, 404, { error: 'not found' });
  }

  private handleDescriptor(res: ServerResponse): void {
    const descriptor: HostDescriptor = {
      peerId: this.identity.peerId,
      label: this.identity.label,
      protocol: PROTOCOL_VERSION,
      capabilities: this.capabilities,
    };
    sendJson(res, 200, descriptor);
  }

  private async handlePair(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await this.readBody(req, res);
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
    if (!this.pairingTokens.consume(token).valid) {
      sendJson(res, 401, {
        error: 'invalid, expired, or already-used pairing token',
      });
      return;
    }
    const peerId = this.peers.upsert({
      peerId: derivePeerId(publicKeyPem),
      label,
      publicKeyPem,
      endpoints: Array.isArray(endpoints)
        ? endpoints.filter((e): e is string => typeof e === 'string')
        : [],
    }).peerId;
    this.log(`paired with ${peerId}`);
    sendJson(res, 201, {
      peerId: this.identity.peerId,
      label: this.identity.label,
      publicKeyPem: this.identity.publicKeyPem,
      endpoints: this.endpoints,
      protocol: PROTOCOL_VERSION,
    });
  }

  private handleChallenge(peerId: string, res: ServerResponse): void {
    if (!this.peers.get(peerId)) {
      sendJson(res, 404, { error: 'unknown-peer' });
      return;
    }
    sendJson(res, 200, { challenge: this.auth.issueChallenge() });
  }

  private async handleSession(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await this.readBody(req, res);
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
      const result = this.auth.proveSession({
        peerId,
        challenge,
        signature,
        clientChallenge,
      });
      this.peers.touch(peerId);
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof AuthError) {
        sendJson(res, AUTH_STATUS[error.kind], { error: error.kind });
        return;
      }
      throw error;
    }
  }

  private handleRtc(res: ServerResponse): void {
    sendJson(res, 501, { error: 'this host was built without WebRTC support' });
  }

  private handleUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer
  ): void {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const ticket = url.searchParams.get('ticket') ?? '';
    let peerId: string;
    try {
      peerId = this.auth.consumeTicket(ticket);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss?.handleUpgrade(req, socket, head, (ws) => {
      const connection = createConnection({
        peerId,
        role: 'acceptor',
        socket: wrapWebSocket(ws),
        registry: this.registry,
      });
      this.connections.add(connection);
      this.peers.touch(peerId);
    });
  }

  private async readBody(
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
}
