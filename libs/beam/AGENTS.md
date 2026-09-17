# libs/beam — @n10/beam

Pairs two machines and carries streams between them: identity, the symmetric
peer table, the frame protocol, mutual auth, the host's HTTP + WebSocket
surface, the client's pair/dial flow, the `pty`/`exec`/`msg` stream handlers,
and the durable mailbox. See `docs/beam.md` at the repository root for the
full contract — that document, not this file, is authoritative on wire
format and behavior.

No n10, git, tmux or Orchestra imports (lint-enforced by the workspace's
project boundaries): this library knows nothing about worktrees, agents,
report kinds or `@orchestra-*` tags. `apps/beam`, `apps/desktop` and the
Orchestra plugin's shell scripts are the only intended consumers, all
through the exported API in `src/index.ts`.

- **Identity and trust** (`identity.ts`, `peer-table.ts`, `auth.ts`): a
  `peerId` is always derived from a public key (`derivePeerId`), never
  asserted over the wire — `pair()` re-derives the host's claimed id and
  rejects a mismatch rather than trusting it (see `client.ts`). Revocation
  must be effective everywhere a peer is checked: `/challenge`, `/session`,
  the WS upgrade (ticket alone is not enough — the peer's current state is
  re-checked at upgrade time), and any already-live connection.
- **Frame protocol and muxer** (`protocol.ts`, `muxer.ts`, `stream.ts`): the
  wire codec is pure and has no I/O; another implementation matches it byte
  for byte. `Open`'s payload carries the stream name and its JSON parameters
  in one frame (a `{`-prefixed payload), never a name followed by a separate
  parameter frame — the latter cannot be told apart from the stream's first
  real byte of data by a handler with optional parameters. `seq` counts
  every frame on a stream (Open, Data, Close), not just Data; the
  `SeqTracker` verdict is enforced, not merely computed — a gap closes the
  stream rather than being delivered as data. `FrameDecoder.finish()` is
  wired into the real transport-end path (`connection.ts`), so a connection
  that dies mid-frame is reported as truncated, not as an ordinary close.
- **Connections** (`connection.ts`, `connection-registry.ts`): a
  `PeerConnection` is identical whether this machine dialed or accepted —
  that symmetry is what lets the mailbox drain over whichever connection
  exists, regardless of who opened it. Both `Host` (accepted) and `dial()`
  (dialed) register every live connection into a `ConnectionRegistry`; a
  mailbox flusher that only checked one side would silently fail to reach
  half of its peers.
- **Streams** (`pty-handler.ts`, `exec-handler.ts`): a handler is registered
  once on a `StreamRegistry` shared by every connection on a node, so its
  own bookkeeping must key on `(peer, streamId)`, never bare `streamId` —
  stream ids are only unique within one connection, and two peers can each
  open id 1 at the same moment. `argv[0]` always runs directly; nothing here
  ever passes a caller's argv through a shell.
- **Injected environment** (`injected-env.ts`): `BEAM_DIR`, `BEAM_INBOX`,
  `BEAM_PEER_ID`, `BEAM_CALLER_ID`, `BEAM_CALLER_LABEL` are appended last, so
  a caller's own `env` open parameter cannot spoof who it is. Never inject a
  private key, a ticket or a pairing token into a child's environment.
- **Durable mailbox** (`mailbox/`): one queue per peer, not per role or
  direction — `mailbox/out/<peerId>/`, drained strictly sequentially
  (send, await ack, unlink, next) over whichever connection to that peer is
  live. `queued` is a success outcome, not a pending failure: the message is
  durable and the caller must not resend it. The receiver dedups by
  persisting the highest accepted `seq` per sender; a malformed queue file
  is quarantined, not left to block the messages behind it.
- **Local IPC** (`ipc-socket.ts`): `$BEAM_DIR/run/inbox.sock`, mode `0600`,
  line-delimited JSON. Only remove a stale socket left by a crashed node;
  check liveness before unlinking one a running node may still own.
