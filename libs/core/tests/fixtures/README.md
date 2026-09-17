# Orchestra plugin fixture

`orchestra.tar.gz` is the unmodified `orchestra/` directory at commit
`5523f241c5f2082d337617b578ac5960be4e2ab6`. The plugin manifest declares
version 2.0.0 and MIT licensing. Orchestra is published from
[notaharness/plugins](https://github.com/notaharness/plugins); this commit
predates that repository and is available from
[its original history](https://github.com/HermannBjorgvin/agent-plugins/tree/5523f241c5f2082d337617b578ac5960be4e2ab6/orchestra).

SHA-256: `745ec2a22cfdd8b9548b50e2f42e9fba1544504541a5634c35b12789bdd0150e`.

Generate from a checkout that contains the commit:

```sh
git archive --format=tar.gz --output=orchestra.tar.gz 5523f241c5f2082d337617b578ac5960be4e2ab6 orchestra
```

To update, review a commit from `notaharness/plugins`, export it with the same
command, and update this provenance and the checksum in `orchestra-fixture.ts`. Commit the
archive so ordinary tests need no network, credentials, or installed agent CLI.

Tests unpack the complete plugin into a temporary HOME, validate its manifest
and skill entry points, and execute its installed Bash scripts. This tests the
plugin package and runtime, not an agent CLI's plugin manager or model behavior.
`fake-orchestra-agent.mjs` implements a small scripted agent and queue receiver.
