# beam

beam pairs machines and carries streams between them. It replaces SSH as the way one
machine reaches another; it does not replace tmux, which still holds agent processes and
carries their identity. Everything about repositories, worktrees and agents lives above
beam: `libs/beam` never imports git, tmux or n10 concepts.

Consumers: `apps/beam` (standalone CLI), `apps/desktop` (multi-host UI), and the Orchestra
plugin's shell scripts through the CLI. The library has no n10-specific imports so it can be
published on its own later.

## Layering

| Layer                  | Owns                                                                  | Lives in                                  |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| Orchestra scripts, n10 | worktrees, agent launch, report kinds, tag meanings                   | plugins repo, `libs/core`, `apps/desktop` |
| tmux                   | process persistence, `@orchestra-*` identity tags                     | one tmux server per machine               |
| beam                   | pairing, mutual auth, streams (`pty`, `exec`, `msg`), durable mailbox | `libs/beam`                               |
| network                | reachability                                                          | LAN, Tailscale, tailcat (later)           |

## Identity

One identity per machine, used whether the machine is accepting or dialing. There is no
separate "device" concept: a paired pair of machines are peers.

- **Keypair**: Ed25519, PEM, generated on first use, stored `$BEAM_DIR/identity.json`, mode
  `0600`. The private key never leaves the machine and is never sent over a connection.
- **`peerId`**: first 16 hex characters of the SHA-256 of the public key PEM. Derived, not
  minted, so both sides independently compute the same id for the same machine. (host-poc
  minted a random `deviceId` on the host; that cannot work symmetrically.)
- **`label`**: human name, defaults to the system hostname, local to each machine. Labels are
  display and lookup only; `peerId` is identity. Renaming a peer never changes its id.

`$BEAM_DIR` is `$BEAM_CONFIG_DIR`, else `$XDG_CONFIG_HOME/beam`, else `~/.config/beam`.

```
$BEAM_DIR/
  identity.json          this machine's keypair + label            (0600)
  peers.json             the peer table                            (0600)
  mailbox/
    seq                  monotonic send counter
    out/<peerId>/        one file per undelivered message
    seen/<peerId>.json   highest accepted seq from that peer
  run/inbox.sock         local IPC socket, present while a node runs (0600)
```

### Peer table

```ts
interface PeerRecord {
  peerId: string; // derived from publicKeyPem
  label: string; // local display name, unique within the table
  publicKeyPem: string; // used to verify everything this peer signs
  endpoints: string[]; // where we may dial it; may be empty
  pairedAt: number;
  lastSeenAt?: number;
  revoked: boolean; // kept, never matched, never dialed
}
```

Trust is symmetric (both sides hold the other's public key after one pairing). Reachability
is not: a peer can be dialed only if we know an endpoint for it and it is accepting. A peer
with no endpoint can still reach us, and we can still answer it — which is what lets a
laptop supervise a worker box without being reachable itself.

Endpoints are opaque strings. Nothing in the library assumes a direct IP, so a relayed or
tunnelled endpoint can be added later without touching this model.

## Pairing

Symmetric: one pairing act leaves both tables holding the other side's key.

1. B runs `beam serve`, which mints a single-use token (32 random bytes, base64url, 10 minute
   TTL) and prints a URL carrying it in the **hash**: `http://<endpoint>/pair#token=…`.
   The hash keeps the token out of request lines, proxy logs and `Referer`.
2. A runs `beam pair <url>`: it reads B's descriptor, then posts
   `{ token, publicKeyPem, label, endpoints }` — `endpoints` being where B may dial A back,
   empty when A does not accept connections.
3. B consumes the token (single use, whether or not the rest succeeds), stores A as a peer,
   and answers with its own `{ peerId, label, publicKeyPem, endpoints, protocol }`.
4. A stores B as a peer. Both sides can now authenticate the other.

A label collision on either side is resolved locally by appending `-2`, `-3`, …; the id is
what matters. Re-pairing an existing peer replaces its key only with `--force`, and the CLI
says which peer it would replace — a silent key swap is indistinguishable from an attacker.

### HTTP surface

Authentication only; no payload ever travels over HTTP. Bodies are capped at 64 KiB.

| Method | Path                     | Purpose                                                                        |
| ------ | ------------------------ | ------------------------------------------------------------------------------ |
| GET    | `/.well-known/beam/host` | descriptor: `{ peerId, label, protocol, capabilities }`                        |
| POST   | `/pair`                  | trade a token plus public key for mutual peer records                          |
| GET    | `/challenge/:peerId`     | `{ challenge }` — a nonce for that peer to sign (60s TTL)                      |
| POST   | `/session`               | mutual proof, returns `{ ticket, hostSignature }` (ticket 30s TTL, single use) |
| POST   | `/rtc`                   | WebRTC offer for a ticket, returns the answer                                  |
| GET    | `/ws?ticket=…`           | upgrade to the stream connection                                               |

`POST /session` takes `{ peerId, challenge, signature, clientChallenge }`. The host verifies
the peer's signature **before** consuming the challenge, so a bogus signature cannot burn the
legitimate one. It then signs `clientChallenge` with its own key and returns that signature;
the client verifies it against the stored `publicKeyPem` and aborts on mismatch. Mutual proof
means neither side talks to an impostor, which matters because the WebSocket transport is not
itself encrypted.

Failure modes are distinguishable, because the UI has to explain them: unknown peer, revoked
peer, bad signature, stale challenge, spent ticket, host key mismatch.

## Frame protocol

Unchanged from host-poc. One ordered transport carries a control channel plus any number of
named streams.

```
header (12 bytes)                                  payload
+--------+---------+-----------+----------+-----------+------------+
| ver u8 | type u8 | sid u16be | seq u32be | len u32be |   bytes    |
+--------+---------+-----------+----------+-----------+------------+
```

`type` is `Open(0) | Data(1) | Close(2) | Control(3)`. `seq` counts frames per stream per
direction from 0; a receiver feeds sequences through a tracker that distinguishes ok,
duplicate, gap and reorder. `MAX_PAYLOAD` is 1 MiB. Version mismatch, unknown type, oversized
declared length and truncation are distinct decode errors.

`Open` carries the stream name as UTF-8. Capabilities are advertised in the descriptor and the
handshake, so new stream names are additive: a client checks the capability before opening.
Current names: `pty`, `pty:<program>`, `exec`, `msg`.

## Streams

### `pty`, `pty:<program>`

A real terminal, `node-pty` on Node. `pty` runs the login shell (`$SHELL`, else bash, else
sh); `pty:<program>` runs that program with no shell parsing of arguments. `Control`
`{ kind: "resize", streamId, cols, rows }` resizes, clamped to 2–500 in both axes because the
numbers come from the far side. Closing the stream kills the process; the process exiting
closes the stream with a reason. A cap of 32 live PTYs per connection.

### `exec`

The `ssh host cmd` contract: run an argv, pipe stdin, get stdout, stderr and an exit code.
This is what lets a caller run `git` and `tmux` on the far machine without beam knowing what
those commands mean.

`Open` payload is JSON: `{ argv: string[], cwd?: string, env?: Record<string,string> }`.
`argv[0]` is executed directly — no shell, no word splitting. `cwd` must be absolute or start
with `~/`. Provided `env` entries are merged over the host's environment, not replacing it.

Data frames on an exec stream carry a one-byte channel prefix: `0` stdin (client→host), `1`
stdout, `2` stderr (host→client). The prefix is local to the exec handler; the muxer stays
payload-agnostic. `Close` from the host carries `{ exitCode, signal }`. Closing from the
client kills the process group.

### `msg`

Carries mailbox envelopes (below). Either side may open it, because either side may send.

## Durable mailbox

A message is an opaque payload addressed to a peer. beam never parses `payload`; `topic`
exists so a receiver can subscribe to what concerns it.

```ts
interface Envelope {
  id: string; // uuid
  from: string; // sender peerId
  to: string; // recipient peerId
  seq: number; // monotonic per sender, strictly increasing
  topic: string; // free-form, e.g. "orchestra"
  payload: string; // utf8 or base64 per `encoding`
  encoding: 'utf8' | 'base64';
  createdAt: number;
}
```

Payload cap 256 KiB, so an envelope always fits one frame.

**One queue per peer, not per role.** Each node keeps `mailbox/out/<peerId>/`, one file per
undelivered message, written temp-then-rename and named by zero-padded `seq` so the directory
sorts into send order. A message is unlinked only when the recipient acknowledges it.
Whenever a live connection to that peer exists — **whichever side dialed** — the flusher
drains that queue in order over a `msg` stream. This single mechanism serves both directions,
which is why a player on a worker box can report to an orchestrator on a laptop that the
worker box cannot dial.

**Delivery.** Strictly sequential: send one envelope, wait for its ack, unlink, continue. The
receiver persists the highest accepted `seq` per sender in `mailbox/seen/<peerId>.json`,
accepts `seq == last + 1`, re-acks and drops anything at or below `last` (the duplicate a
crash between delivery and ack produces), and treats a gap as an error rather than silently
accepting out of order. At-least-once on the wire plus receiver dedup means the receiving
application sees each message exactly once, in sender order. Acks are `Control`
`{ kind: "ack", id, accepted: true|false, reason? }`.

**Flush triggers**: a connection to the peer becoming live (either direction), node start,
and a bounded retry while a connection stays up. No timers are needed for offline peers —
there is nothing to try.

### Send outcomes

`send()` resolves to one of three outcomes, and the distinction is user-visible:

| Outcome     | Meaning                                                                     | Caller behaviour             |
| ----------- | --------------------------------------------------------------------------- | ---------------------------- |
| `delivered` | the recipient acked                                                         | done                         |
| `queued`    | no live connection, or no ack before the timeout; the envelope is persisted | **success** — do not resend  |
| `rejected`  | unknown peer, revoked peer, or payload over the cap                         | failure — nothing was stored |

`queued` is a success because the message is durable. Anything that reports to a human or an
agent must say so in those terms, so the sender does not sit waiting for a reply that cannot
come yet or, worse, send it again:

```
queued for workbox — that machine is not connected right now. beam will deliver this
message the next time it comes online. Do not send it again.
```

`rejected` must name which of the three causes applied.

### Local IPC

While a node runs it listens on `$BEAM_DIR/run/inbox.sock` (mode `0600`), so any process on
that machine can send and receive without holding the identity itself. Requests and responses
are line-delimited JSON:

```
{"op":"send","to":"<peerId|label>","topic":"orchestra","payload":"…","encoding":"utf8"}
  → {"status":"queued","to":"<peerId>","label":"workbox","queueDepth":2,"reason":"peer not connected"}
{"op":"subscribe","topic":"orchestra"}      → one envelope per line; each acked as it is taken
{"op":"status"}                             → peers, reachability, queue depths
```

One node per `$BEAM_DIR`. A CLI that needs an existing node's connections (`msg send` from a
script, `msg listen` beside a running node) uses this socket; a one-shot dial (`exec`,
`connect`) may start its own ephemeral node instead. Because dedup state is shared through
`$BEAM_DIR`, a second node cannot cause double delivery.

### Injected environment

Processes started by the host for a `pty` or `exec` stream get:

| Variable            | Meaning                                    |
| ------------------- | ------------------------------------------ |
| `BEAM_DIR`          | config directory in use                    |
| `BEAM_INBOX`        | path to the local IPC socket               |
| `BEAM_PEER_ID`      | this machine's id                          |
| `BEAM_CALLER_ID`    | the peer that opened the stream            |
| `BEAM_CALLER_LABEL` | that peer's label as this machine knows it |

A script that beam started can therefore answer the machine that started it without being
configured, which is how `report.sh` finds its way home.

## Identity scoping across machines

Every id belongs to the machine it lives on: tmux session names, worktree paths, pane ids,
n10 registry keys. Two machines may hold the same branch, the same worktree path and the same
session label. A target that crosses machines is written `beam:<peer>/<local target>` where
the local part is whatever the receiving side understands (`tmux:<session>`,
`codex:<thread-id>`). Registry keys in `libs/core` gain a machine segment whose local value is
`local`, so existing local behaviour is unchanged and remote entries cannot collide with it.

## Security posture

- Pairing grants a shell as the user running the node. `exec` adds no privilege a `pty` stream
  did not already give. Treat pairing like granting SSH access; `beam revoke` takes it back
  immediately, and a revoked peer fails authentication rather than being silently ignored.
- The WebSocket transport is not encrypted. WebRTC data channels are (DTLS). Mutual
  authentication is mandatory on both, so a plain-WS network attacker can read traffic but
  cannot impersonate either side. Run over Tailscale or tailcat when the network is not
  trusted.
- Default bind is loopback. Exposing the node on other interfaces requires an explicit
  `--hostname`, and the node prints what it bound.
- The pairing URL is a bearer token for its 10 minute window; anything that captures stdout
  captures it.
- The mailbox stores payloads unencrypted at rest, under `0600`, and never executes them. A
  relay that delivers a message into a terminal must check what owns that terminal, exactly as
  Orchestra's `pane_owned_by_agent` does today.

## Deliberately out of scope, doors left open

| Later                                     | What keeps it possible                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| tailcat or relayed transports             | `Transport` is an interface; `endpoints` are opaque strings                     |
| ssh executor for Orchestra                | the scripts route every tmux and git call through one executor                  |
| several tmux servers or sessions per host | every tmux call carries its socket path; targets have room for a server segment |
| agent-to-agent messaging                  | envelopes carry `from`; topics are free-form; both sides can open `msg`         |
| publishing `libs/beam` on its own         | no n10 imports, no assumptions about the caller                                 |
| store-and-forward for other apps          | the mailbox is addressed by peer and topic, not by Orchestra concepts           |
