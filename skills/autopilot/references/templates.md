# Templates

Starting points for the autopilot skill. Rename sections, paths, labels, and
commands to fit the repo. Keep what applies.

## Audit JSON

`audit-detect.mjs` writes it; you fill the judgment fields; `audit-report.mjs`
validates and renders it (`--json` prints `{ ok, errors, summary }` only).

```jsonc
{
	"schemaVersion": 1,
	"repo": { "name": "app", "commit": "abc1234" },
	"stack": {
		"summary": "python (uv) · django, pytest",
		"evidence": ["package.json"],
	},
	// Each command you ran (exitCode), or { "command", "skipped": "<reason>" }.
	"verify": { "results": [{ "command": "make verify", "exitCode": 0 }] },
	// Deterministic findings from the detector plus your own.
	"findings": [{ "text": "CI skips format check", "rung": 1 }],
	"rungs": [
		{
			"id": 1, // all 12, once each; pillar must match the rung
			"pillar": "good-prs", // good-prs | review | blast-radius | improve
			"name": "Agent map + one verify command in CI",
			"score": "partial", // done | partial | missing | unknown | n/a
			"evidence": ["AGENTS.md", ".github/workflows/ci.yml"], // supports the score
			"checked": [], // looked for, not found (needed for missing/unknown without evidence)
			"inferred": false, // true when no file can show it; needs notes
			"notes": "CI runs lint and test but not format:check", // required unless done/missing
		},
	],
	// Plan step: one row per partial/missing rung, ladder order.
	"plan": [
		{
			"rung": 1,
			"title": "Run the full verify command in CI",
			"files": [".github/workflows/ci.yml"],
			"effort": "S", // S | M | L
			"door": "two-way", // two-way | one-way
		},
	],
	// Hand-off step.
	"prs": [
		{ "rung": 1, "url": "https://…/pull/12", "status": "open", "note": "" },
	],
}
```

## Merge-order dependency map

The report computes each plan row's Pillar and Needs. **Needs** (merge first;
edit here and keep `audit-report.mjs` `rungs[].needs` in sync):

- 1 before all
- 5 before 6 and 11
- 4 and 6 before 7
- 6 before 10
- 10 and 11 before 12

Needs that are done or `n/a` drop out.

## AGENTS.md (map, keep it short)

```md
# <project> agent index

<One paragraph: what this is and who uses it.>

`<verify command>` is the single local gate. CI runs the same command. Commit
and pre-push hooks run lint, format, typecheck, and dead-code checks.

This file is a map. Open the page that owns the task:

- Contributing and setup: <link>
- Architecture and primitives: <link>
- Decisions (read before proposing big changes): <link>
- Shipping a PR: <link to ship-pr skill>
- Filing friction: <link>
```

Link the pages and skills agents use for each task.

## PR template

```md
## Intent

<What the PR does, one or two sentences.>

Door: <two-way | one-way>
<!-- one-way: data, contracts, security, money, public API, store release -->

Cleanup: <none | needed (#issue) | done>

## Why

## Testing

<Commands run and their result: tests and typecheck, then the control CLI proof
(e.g. `control-<project> request GET /x --contains Y`,
`execute --code-file <fixture>`, `browse --record` video for UI;
`preview --pr 42` only for production-like changes). What data you used. Why any
test expectation changed. Say what you could not verify.>

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

Index rules: half a page each, only for decisions that span several PRs or that
an agent would otherwise re-propose, supersede instead of editing history, and
check numbers for collisions in CI if parallel agents write them.

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
owner in this repo. One papercut per issue. Search open issues first. Keep
secrets and private data out.

## Kody yes / no

**Kody yes** ([connect](https://kody.codes/docs/connect-your-agent.md);
[secrets](https://kody.codes/docs/secrets.md) agents use by name,
[jobs](https://kody.codes/docs/triggers.md) for cron agents):
[`@kentcdodds/ship-pr`](https://kody.codes/@kentcdodds/ship-pr) (`tick`) and
[`@kentcdodds/friction-log`](https://kody.codes/@kentcdodds/friction-log) are
**Kent's defaults** (Bugbot/CodeRabbit/Devin/Seer review sort, Discord summary,
daily [`kody-hq/kody`](https://github.com/kody-hq/kody) sweep): a template to
fork and reconfigure for your stack.

**Kody no:**
`curl -fsSL https://raw.githubusercontent.com/kentcdodds/kcd-skills/main/skills/autopilot/scripts/ship-pr.mjs -o scripts/ship-pr.mjs`
(use the repo's script folder), write `.github/ship-pr.json` from the interview
form, and use the issue form and CI cron.

## Cleanup automations (rung 12)

Recommended agents: four on a schedule, plus event-driven errors → issues. Each
one opens a PR (one per run, none when there is nothing to do; errors → issues
files the issue first, then a PR once the cause is clear) and goes through the
ship loop like any other change.

| Automation                        | When                                    | Opens a PR that…                                                                                                         |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Legacy reaper                     | Weekly                                  | removes dead code, expired flags (rung 8 removal conditions), and `Cleanup:` items whose "ready when" holds              |
| Test pruning (`keep-tests-tight`) | Daily; skip if no commits in 24h        | deletes redundant, flaky, or implementation-detail tests while keeping behavior covered                                  |
| Docs freshness                    | Daily; skip if no commits in 24h        | fixes `AGENTS.md`, README, and decisions that recent commits made stale; trims skills and docs to the ones agents cite   |
| Friction sweep                    | Daily                                   | fixes open `friction` issues; closes fixed or invalid ones with a note                                                   |
| Errors → issues                   | On a new error group or failing prod CI | files one deduped issue per error (repro and link, free of secrets and user data), then a fix PR when the cause is clear |

**Merge gate (risk tiers from the interview):** only low- and medium-risk PRs
auto-merge, only with green CI, and within the **Agent may merge** answer.
Medium still needs its AI reviewer (+ rung 4 proof). High risk, red or pending
CI, and anything in **Always human** park for the human.

**Kody yes:** fork
[`@kentcdodds/codebase-cleanup`](https://kody.codes/@kentcdodds/codebase-cleanup)
(legacy reaper, docs freshness, keep-tests-tight, prod CI failure → fix agent)
and [`@kentcdodds/friction-log`](https://kody.codes/@kentcdodds/friction-log)
(daily friction sweep). They are **Kent's defaults**: every automation starts
disabled with no repos, so you list repos and a notify target, then enable the
ones you want. The package is hidden from Kody search; this link is how you find
it. A template to fork and adapt.

**Kody no:** one scheduled CI workflow per automation (`schedule:` cron, or a
scheduled pipeline) that launches your coding agent with the same prompt and
merge gate. Trigger errors → issues from your error tracker's alert webhook
(`repository_dispatch`) or a failed default-branch `workflow_run`. Name the
files after the automation (for example `.github/workflows/legacy-reaper.yml`)
so the audit finds them.

## Ship-PR loop

Prose loops wander: each agent re-reads and re-interprets them. Put the
decisions in code and keep the skill thin.

- **Kody:** call the `tick` export of
  [`@kentcdodds/ship-pr`](https://kody.codes/@kentcdodds/ship-pr), act on the
  step it returns, and tick again. Same Kent defaults as **Kody yes / no** above
  — fork and reconfigure.
- **GitHub without Kody:** copy
  [`ship-pr.mjs`](https://github.com/kentcdodds/kcd-skills/blob/main/skills/autopilot/scripts/ship-pr.mjs)
  into the repo with
  `curl -fsSL https://raw.githubusercontent.com/kentcdodds/kcd-skills/main/skills/autopilot/scripts/ship-pr.mjs -o scripts/ship-pr.mjs`
  (adapt the folder; Node 18+, needs an authenticated `gh`). Each run reads the
  PR once and prints one next action (`--json` for agents). It acts on its own
  only when the action is safe (mark a draft ready), or when you pass `--merge`
  and policy allows it. With no config, low risk needs green CI only and
  medium/high park with "no reviewer configured".

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
   with why; answer every "unsure" thread), resolve conflicts, or wait.
   Reviewers scrutinize every changed test expectation against the intent.
4. Repeat step 2 until it says `merge`, `parked`, or `done`. Merge only with
   `--merge` when the maintainer's policy allows it for this tier.
5. Before merge, prove the PR locally with the control CLI against `dev`
   (`request --contains`, `execute`, `browse --record` for UI); use
   `preview --pr` only for production-like changes. Cite the commands under
   Testing. After merge, confirm the running version:
   `control-<project> health --sha <merge-sha>`.
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
