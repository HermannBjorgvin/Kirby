/**
 * @n10/beam — pairs two machines and streams terminals and commands between
 * them. See docs/beam.md at the repository root for the full spec.
 *
 * This is Phase 1: identity, the peer table, the frame protocol, mutual
 * auth, the host's HTTP + WebSocket surface, the client's pair/dial flow,
 * and a `pty` stream handler backed by node-pty. The `exec` and `msg`
 * streams and the durable mailbox are later phases; the stream registry and
 * PeerConnection interface here are the seam they land on.
 */

export { resolveBeamDir, type BeamDirEnv } from './lib/beam-dir.js';

export {
  derivePeerId,
  loadOrCreateIdentity,
  type Identity,
  type LoadOrCreateIdentityOptions,
} from './lib/identity.js';

export {
  PeerTable,
  type NewPeer,
  type PeerRecord,
  type PeerTableOptions,
} from './lib/peer-table.js';

export {
  FIRST_SEQ,
  FRAME_HEADER_SIZE,
  FRAME_VERSION,
  FrameDecoder,
  FrameType,
  MAX_PAYLOAD,
  ProtocolError,
  SeqSender,
  SeqTracker,
  decodeControl,
  decodeText,
  encodeControl,
  encodeFrame,
  encodeText,
  type Frame,
  type FrameTypeValue,
  type ProtocolErrorKind,
  type SeqVerdict,
} from './lib/protocol.js';

export {
  CHALLENGE_TTL_MS,
  PAIRING_TOKEN_TTL_MS,
  TICKET_TTL_MS,
  SingleUseSecrets,
  randomSecret,
  type ConsumeResult,
} from './lib/secrets.js';

export {
  AuthError,
  MutualAuth,
  signNonce,
  verifyHostSignature,
  verifySignature,
  type AuthErrorKind,
  type MutualAuthOptions,
  type SessionProof,
  type SessionResult,
} from './lib/auth.js';

export type { BeamStream, StreamSink } from './lib/stream.js';
export {
  StreamRegistry,
  type StreamOpenHandler,
} from './lib/stream-registry.js';
export { Muxer, type MuxerOptions, type MuxerRole } from './lib/muxer.js';

export {
  WebSocketTransport,
  wrapWebSocket,
  type Transport,
  type TransportSocket,
} from './lib/transport.js';

export {
  createConnection,
  type CreateConnectionOptions,
  type PeerConnection,
} from './lib/connection.js';
export { ConnectionRegistry } from './lib/connection-registry.js';

export {
  createPtyStreamHandler,
  shellForEnv,
  MAX_PTY_SESSIONS,
} from './lib/pty-handler.js';

export {
  DESCRIPTOR_PATH,
  Host,
  PROTOCOL_VERSION,
  type HostDescriptor,
  type HostOptions,
} from './lib/host.js';

export {
  dial,
  fetchDescriptor,
  pair,
  type DialOptions,
  type PairOptions,
  type PairResult,
} from './lib/client.js';
