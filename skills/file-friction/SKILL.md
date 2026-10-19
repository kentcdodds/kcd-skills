---
name: file-friction
description: >
  File durable repo or package papercuts as friction issues. Use when a session
  hits leftover friction outside the ship-pr leftover pass. Ship-pr files its
  leftovers before the summary.
---

# File friction

**File** durable, recurring pain with a clear owner and a reproducible contract
gap: a missing step, a lying type, a broken harness, docs that disagree with the
code, a brittle test. The next agent should be able to act on it without your
session. One-off confusion and session-only nits stay in the session.

Fix obvious, low-risk friction in the current change when it is in scope, and
mention the fix. File what is left over.

Search open `friction` issues first and comment on a match. Each issue carries
what the project's friction form asks for: what happened, what you wanted, how
to reproduce, the cost, what you already looked at, and relevant files. Keep
secrets and private data out.

Give each issue a priority and, when it needs a human call, the decision marker
from the project's triage scheme (autopilot rung 11; default `P0`–`P3` labels
plus `needs-decision`). `friction-skipped` marks an issue the friction sweep
leaves alone until someone removes the label.

## Command

With Kody, file through
[`@kentcdodds/friction-log`](https://kody.codes/@kentcdodds/friction-log) via
[prefer-local-kody-execute](../prefer-local-kody-execute/SKILL.md). Pass the
required `target` and `items` (a one-element array is fine).
`{ host: 'github', repo: 'owner/repo' }` opens or reuses a `friction` issue on
that repo; `{ host: 'kody', repo: '@owner/leaf' }` routes to that Kody package's
owner.

```bash
npx @kodycodes/cli execute --local \
  --code 'import run from "kody:@kentcdodds/friction-log/file"; export default (p) => run(p)' \
  --params '{"target":{"host":"github","repo":"owner/repo"},"items":[{"title":"…","whatHappened":"…","whatYouWanted":"…","howToReproduce":"…","cost":"…","preliminaryInvestigation":"…","relevantFiles":["…"]}]}'
```

Results land in `filed`, `reused`, `woke`, or `skipped`. A `skipped` item did
not meet the bar; leave it unfiled. Then add the priority to each filed issue.

Without Kody, open the issue with the repo's friction form or the tracker's
equivalent, with the `friction` label and the priority.
