# Azure DevOps fixtures

Azure DevOps has no live e2e coverage in this repo (see the provider
table in the root `CLAUDE.md`), so the responses that have actually
broken Kirby are kept here instead and read with `readFileSync` in the
specs — data, never part of the module graph.

Two kinds live here, and the difference matters when you trust one:

**Recorded.** Taken from a real organization and then scrubbed: org,
project and repository names replaced, `createdBy` identities removed,
nonces redacted. Everything else is verbatim, including the fields
Kirby ignores.

| File | What it captures |
| --- | --- |
| `pr-statuses-failed-then-not-applicable.json` | a check that failed and then withdrew |
| `pr-statuses-four-iterations-withdrawn.json` | the same check reporting across four pushes |
| `pr-statuses-withdrawn-after-build-failure.json` | the coverage check standing down because the build gave it nothing |
| `pr-builds-failed.json` | a red pipeline reached through the builds API |
| `signin-page.html` | the HTML Azure serves under `203` in place of JSON when the PAT is dead |

**Constructed.** Built by hand from the documented response shape
because there was no organization to record from. Trustworthy about
*structure* — field names, nesting, which fields are optional — and not
evidence about what a real server sends.

| File | What it stands in for |
| --- | --- |
| `builds-batch.json` | one `GET /_apis/build/builds?repositoryId=…` page covering several pull requests at once |

To record a new one, hit the API with the PAT from `~/.kirby/config.json`,
scrub the identifiers above, and add a row here saying what the response
was of. Prefer recording over constructing: the bugs in this provider
have consistently been in fields nobody thought to invent.
