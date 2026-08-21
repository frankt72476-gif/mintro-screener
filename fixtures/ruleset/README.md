# Rule set fixtures

    valid-minimal.json    A well-formed rule set: one rule of each of six check-type shapes.
    malformed/            One file per defect. Every one of these must fail to load.

## Working with these

`malformed/` is not a pile of broken files to be tidied up. Each one is a specific defect the
loader is required to catch, and each is asserted against in
`packages/ruleset/test/malformed.test.ts` — that test names the rule the defect must be
attributed to, a fragment of the message, and what the fixture is protecting against. Read it
as the manifest for this directory rather than duplicating the list here.

Two tests keep the directory honest:

- **covers every fixture** — a file added here without a matching case in the test fails.
- **rejects every fixture** — a fixture that starts loading successfully fails.

So adding a fixture means adding its case, and neither can drift from the other.

## Adding one

Add the file, then add its case to `CASES` in the test. Keep fixtures minimal — a header plus
the smallest set of rules needed to express the defect — and change exactly one thing from
`valid-minimal.json`, so a failure points at one cause. `multiple-defects.json` is the
deliberate exception: it proves defects are reported together in a single pass rather than one
per run.

Fixtures are generated from a common base so they stay consistent; they are committed as
plain JSON and can be edited directly.
