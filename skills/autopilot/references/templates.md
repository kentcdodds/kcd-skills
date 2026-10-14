# Templates

Starting points for the autopilot skill. Rename sections, paths, labels, and
commands to fit the repo. Remove what does not apply.

## AGENTS.md (map, keep it short)

```md
# <project> agent index

<One paragraph: what this is and who uses it.>

`<verify command>` is the single local gate. CI runs the same command.

This file is a map, not the docs. Open the page that owns the task:

- Contributing and setup: <link>
- Architecture and primitives: <link>
- Decisions (read before proposing big changes): <link>
- Shipping a PR: <link to ship-pr skill>
- Filing friction: <link>
```

## PR template

```md
## Intent

<What the PR does, one or two sentences.>

Door: <two-way | one-way>
<!-- one-way: data, contracts, security, money, public API, store release -->

Cleanup: <none | needed (#issue) | done>

## Why

## Testing

<Commands run and their result. What you exercised by hand or on a preview, with
what data. Say what you could not verify.>

## System recap

Risk: <low | medium | high> Touches: <primitive or area> (<composes | extends |
adds>) <Optional: mermaid diagram or 3–5 bullets of the change flow.>
```

`composes` = uses existing pieces as designed (low). `extends` = changes an
existing piece's behavior or contract (medium). `adds` = new piece, data store,
external service, or trust boundary (high).

## Decision record

```md
# NNNN: <short title>

Status: accepted | superseded by NNNN Date: YYYY-MM-DD

## Decision

<The choice, ideally phrased as what not to do.>

## Why

## Revisit if

<Concrete conditions that would change the answer.>
```

Index rules: half a page each, only for decisions an agent would otherwise
re-propose, supersede instead of editing history, and check numbers for
collisions in CI if parallel agents write them.

## Friction issue form (GitHub example; adapt to your tracker)

```yaml
name: Friction
description: A durable, reproducible papercut an agent or human hit.
labels: [friction]
body:
  - type: textarea
    id: what-happened
    attributes: { label: What happened }
    validations: { required: true }
  - type: textarea
    id: expected
    attributes: { label: What you expected or wanted }
    validations: { required: true }
  - type: textarea
    id: repro
    attributes: { label: How to reproduce }
    validations: { required: true }
  - type: textarea
    id: cost
    attributes: { label: Cost (time, retries, wrong output) }
  - type: textarea
    id: files
    attributes: { label: Relevant files or commands }
```

Quality bar: durable (still true tomorrow), recurring, reproducible, has a clear
owner in this repo. One papercut per issue. Search open issues first. Never
include secrets or private data. Not friction: one-off confusion, a nit about
one session, speculation.

## Ship-PR loop

Prose loops wander: each agent re-reads and re-interprets them. Put the
decisions in code and keep the skill thin.

- **Kody:** call the `tick` export of
  [`@kentcdodds/ship-pr`](https://kody.codes/@kentcdodds/ship-pr), act on the
  step it returns, and tick again. Fork the package to change Kent's defaults
  (review bots, Discord summary).
- **GitHub without Kody:** copy
  [`ship-pr.mjs`](https://github.com/kentcdodds/kcd-skills/blob/main/skills/autopilot/scripts/ship-pr.mjs)
  into the repo with
  `curl -fsSL https://raw.githubusercontent.com/kentcdodds/kcd-skills/main/skills/autopilot/scripts/ship-pr.mjs -o scripts/ship-pr.mjs`
  (adapt the folder; Node 18+, needs an authenticated `gh`). Each run reads the
  PR once and prints one next action (`--json` for agents). It changes nothing
  unless the action is safe (mark a draft ready) or you pass `--merge` and
  policy allows it. With no config, low risk needs green CI only and medium/high
  park with "no reviewer configured".

Write `.github/ship-pr.json` from the interview answers. Whole-line `//`
comments are allowed:

```jsonc
{
	// Each entry is a review author login (exact, case-insensitive, optional
	// "[bot]" suffix) or an exact check name. Empty = no AI reviewer gate.
	"reviewers": {
		"low": [],
		"medium": ["cursor"],
		"high": ["cursor", "coderabbitai"],
	},
	// Tiers that always need a human approval before merge.
	"humanApprovalFor": ["high"],
	// Tiers the agent may merge (with --merge) without a human approval.
	"autoMergeFor": ["low"],
	// squash | merge | rebase
	"mergeMethod": "squash",
	// null, or an argv array run after merge; SHIP_PR_SHA holds the merge SHA.
	"deployCheck": ["node", "scripts/check-deployed-version.mjs"],
}
```

Thin skill that wraps either one:

```md
---
name: ship-pr
description:
  Shepherd a pull request to merged or parked. Use when a PR is ready to finish.
---

# Ship PR

1. Fill the PR template, including the system recap.
2. Run `node scripts/ship-pr.mjs <pr> --risk <tier> --json` (the copy in this
   repo) or the Kody tick.
3. Do the one action it returns: fix CI, address review threads (fix, or reply
   why not; never silently resolve "unsure"), resolve conflicts, or wait.
4. Repeat step 2 until it says `merge`, `parked`, or `done`. Merge only with
   `--merge` when the maintainer's policy allows it for this tier.
5. After merge, confirm the running version: <how to check version + health>.
6. File leftover friction (search first) and `Cleanup:` issues.
7. Post a summary to <destination>: what shipped, risk, links, what is left.
```

## GitLab and Linear

- **GitLab:** the decision order is the same; only the adapter changes. Read
  state with `glab mr view <iid> --output json` and `glab ci status`, map
  "draft", "pipeline", "unresolved discussions", and "approvals" to the script's
  normalized fields, and merge with `glab mr merge`. Use
  `.gitlab/merge_request_templates/` and `.gitlab/issue_templates/` for the
  templates above, and scheduled pipelines for cron agents.
- **Linear (or Jira):** keep code review and merge on the code host; put
  friction, cleanup, and decisions-to-make in the tracker. Map the `friction` /
  `friction-skipped` labels to Linear labels and the issue form to a Linear
  template. Link the issue in the PR so the ship loop can close it.
