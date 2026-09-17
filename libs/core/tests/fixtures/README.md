# Orchestra plugin fixture

`orchestra.tar.gz` is the unmodified `orchestra/` directory from
[notaharness/plugins at 49910daa](https://github.com/notaharness/plugins/tree/49910daa13c27f39ac834099e7912ead09b5a626/orchestra).
The plugin manifest declares version 1.0.0 and MIT licensing.

SHA-256: `8f2203443b94cecfc86e31b0aecb5f3d1329fa3612530fd16c30d24ba72d44d5`.

Generate from a checkout of that repository:

```sh
git archive --format=tar.gz --output=orchestra.tar.gz 49910daa13c27f39ac834099e7912ead09b5a626 orchestra
```

To update, review an upstream commit, export it with the same command, and
update this provenance and the checksum in `orchestra-fixture.ts`. Commit the
archive so ordinary tests need no network, credentials, or installed agent CLI.

Tests unpack the complete plugin into a temporary HOME, validate its manifest
and skill entry points, and execute its installed Bash scripts. This tests the
plugin package and runtime, not an agent CLI's plugin manager or model behavior.
`fake-orchestra-agent.mjs` implements a small scripted agent and queue receiver.
