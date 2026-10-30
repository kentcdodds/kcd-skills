---
name: autopilot
description:
  Audit any repository and set it up so coding agents ship changes safely with
  little human review. Use when asked to put a repo on autopilot or make it
  agent-ready.
---

# Put this repo on autopilot

Agents ship most changes; the human owns product decisions. Any stack, any code
host. Sections map to three pillars plus improvement loops.

The tools ship in the `kcd-skills` package: run
`npx kcd-skills@latest autopilot <command>` (`--help` on any command lists its
options). Commands work from local files and git; when one needs something only
the code host knows, it prints what to gather and the format, and you supply it
with whatever tools reach the host.

## Principles

**P1 Good PRs from the start**

1. The repo tells agents what to build and how to prove it.
2. One small `AGENTS.md` map and one verify command (local == CI).
3. Write down the "no": decisions agents would otherwise re-propose.
4. Guidance earns its place by use: keep the skills and docs agents cite.
   Generate maps from the source of truth.

**P2 Review, iteration, and verification through tests and local proof**

5. Scripts decide anything checkable (audit facts, CI, PR state); agents judge.
6. Agents run their own change before merge and claim only what they verified.
   Feature tests prove features; health checks prove the running version.

**P3 Limit blast radius when a mistake reaches production**

7. Risky changes ship dark, and recovery is tested.
8. Product calls and one-way doors go to the human.

**KI Keep improving**

9. Agents file friction after every PR with a priority; other agents fix it,
   highest priority first.

## Rules

- Start editing once the human approves the plan. One setup PR for every planned
  rung's file changes, using the repo's own tools and layout.
- Follow the contribution policy; stop if it excludes agent PRs. In community
  repos, add files and keep the existing CI.
- For libraries, self-hosted, CLI, and mobile projects, "deploy" means
  "release".
- Keep secrets out of files, issues, and PRs.
- Tell the human every manual step (secrets, app installs, access grants,
  settings you cannot apply). Use a concrete checklist: what, where, why. Give
  it at plan approval and again after the setup PR merges for anything still
  open.

## Rungs: done when (audit checklist and ladder)

**P1 Good PRs**

1. Agent map + verify: a short `AGENTS.md` (or equivalent) linking the docs
   agents use; one verify command (tests, typecheck where the language has one,
   lint, format) CI runs in full. Commit and pre-push hooks run the fast static
   checks (lint, format, typecheck, dead-code checks); CI time budgets fail only
   on real problems.
2. Decisions directory: ADRs for multi-PR decisions and the "no", each with
   "Revisit if".
3. Primitives catalog: building blocks, code roots, and an `adrs` list per entry
   (current records that shape it, `[]` when none), kept short. A PR that adds
   or reshapes a primitive, or writes or supersedes an ADR, updates the matching
   `adrs` lists in the same PR.
4. Self-verification: agents run their change locally with a project control CLI
   (`doctor`, `dev`, `login`, `request --contains`, `execute`, `browse`,
   `health --sha`) and a `control-<project>` skill. For apps with routes, a
   Feature Map generated from the framework's route list, with seed-and-reach
   notes, checked in CI. Previews cover production-like checks. Model: Kody's
   `control-kody`; see `npx kcd-skills@latest autopilot verification`.
5. PR template: Intent, Why, Door, Cleanup, Testing, System recap.

**P2 Review and verification**

6. Ship loop: Kody `ship-pr` or `kcd-skills autopilot ship-pr` + config, behind
   a thin `ship-pr` skill.
7. Reviewers + previews: AI reviewers per tier scrutinize test-expectation
   changes made with the code they test; previews for production-like changes;
   agent merge; running-version check after deploy. Reviewers check each PR
   against the project's principles (when it has them), and each principle a
   machine can check becomes a lint rule or test.

**P3 Blast radius**

8. Flags + rollback: flags with owner, metric, removal condition; rollback
   runbook.
9. Backups: scheduled, isolated restore test.

**KI Keep improving**

10. Friction form: issue form + `friction`, `friction-skipped` labels, filed by
    every ship loop and triaged (rung 11).
11. Triage: every issue agents file (friction, cleanup, errors) gets a priority
    and, when it needs a human call, the project's decision marker. Agents work
    the highest priority first; decision-marked issues wait for the human's
    call. Default: `P0`-`P3` labels + `needs-decision`; the team's own scheme
    (labels, a project-board field, a tracker priority field) from the interview
    takes its place.
12. Cleanup issues: `Cleanup:` issues with a falsifiable "ready when", triaged
    (rung 11).
13. Cleanup cron agents (daily friction sweep, errors → issues, docs freshness
    and pruning, test pruning, weekly legacy reaper) open PRs, highest priority
    first (rung 11); only low/medium risk with green CI auto-merges. See
    templates → **Cleanup automations**.

Order: P1 first (checkable), then P2/P3 (trust), then loops.

## 1. Audit (read only)

Leave tracked files unchanged; deploy, publish, release, and push wait for the
ladder. Installing dependencies is fine. Commands gather facts; you judge:

```sh
mkdir -p .autopilot
# Keep audit artifacts out of git (add .autopilot/ to .gitignore if needed).
npx kcd-skills@latest autopilot audit . --out .autopilot/before.json
```

Use a repo-local `.autopilot/` directory (not a shared `$TMPDIR` path).
Re-running `audit --out` on the same file keeps your scores for this repo and
prints what was carried over; it will not merge a file written for a different
repo.

1. **Verify command:** the gate `AGENTS.md` or contributing docs name, else
   `verify.primary`, else each local CI step. Record each by re-running `audit`
   with `--verify "<command>"` (it keeps your edits and marks any verify result
   that was not re-run as carried over).
2. **Host facts:** `npx kcd-skills@latest autopilot host request` prints JSON on
   stdout (paste into `--input`) and gathering tips on stderr (reviewers,
   merges, branch rules, labels, issues). Gather them read-only with the host's
   CLI, API, or web UI, then
   `npx kcd-skills@latest autopilot host .autopilot/before.json --input facts.json`.
3. **Score every rung** against "done when" from evidence (file contents,
   command results):
   `npx kcd-skills@latest autopilot score .autopilot/before.json <rung> <score> --evidence <path> --note "<why>"`.
   It checks the rung right away. Add judgment calls with
   `npx kcd-skills@latest autopilot finding .autopilot/before.json "<text>" --rung <n>`.
   If done needs a command (rung 4, restore test), run `--verify` when it needs
   no secrets; else cap at `partial`. Note what may live outside the repo (NAS,
   Kody jobs).
4. **Report:**
   `npx kcd-skills@latest autopilot report .autopilot/before.json --html .autopilot/before.html`.
   Fix every error it lists.

## 2. Interview

Fill defaults from the audit; ask `____ (human)` fields and any blank/unknown.

```text
Use Kody (https://kody.codes)?   yes (default) | no
P1 Things agents must not do:    ____ (human) 3-5; lens: irreversible, expensive, or user-facing
P2 Agent may merge:              low risk (default) | low+medium | none
P2 Risk tiers:                   low = CI green; medium = +AI reviewer +rung 4 proof; high = +human
P2 AI reviewers:                 <detected logins/check names, or none> on medium + high
P2 Preview or staging:           <detected | none>  (production-like checks only)
P3 Always human:                 ____ (human) Name the changes that always need your approval
                                 (e.g. auth, payments, migrations, public API, store releases)
P3 Deploy/release:               <detected>        version check: <url/command>
P3 Flags + metrics source:       <detected | none>
P3 Backups/restore tested:       <detected | unknown>
KI Issue tracker:                <detected>        labels: friction, friction-skipped
KI Priority + decisions:         <detected | P0-P3 + needs-decision (default)>  How does the team rank work
                                 and flag decisions? (labels, project-board field, tracker priority field, nothing)
```

"Must not do" seeds rung 2; "Always human" defines the high tier. "Priority +
decisions" sets rung 11: `npx kcd-skills@latest autopilot triage request` prints
the format; record it with
`npx kcd-skills@latest autopilot triage .autopilot/before.json --input triage.json`.
Kody yes/no paths: **Kody yes / no** in
`npx kcd-skills@latest autopilot templates`.

## 3. Plan

- `missing` or `partial`: one plan row that finishes the rung (include
  findings). Rows with file changes ship together in a single setup PR (see
  Ladder). `done`: none. `unknown`: ask or verify; if still unknown, open
  question, no plan row.
- Rungs keep ladder order whatever the answers. A `none` answer (or default)
  narrows its rung (no previews in 7, no flags in 8); inapplicable rungs are
  `n/a` with `notes` (e.g. a library has no backups).
- Add one plan row per partial/missing rung:
  `npx kcd-skills@latest autopilot plan add .autopilot/before.json <rung> --title "<title>" [--file <path>] --effort S|M|L --door two-way|one-way`
  (repeat `--file` when the rung needs tracked files; omit `--file` for a
  settings-only or human-only row; the report shows those as `(settings only)`).
  Rows stay in ladder order. Re-run the report; show the **plan table**, open
  questions, and the **human checklist** (below); wait for approval.
- If every plan row is settings-only (no file paths), open **no** setup PR.
  Apply the host settings, send the human checklist, and hand off.

**Human checklist (plan time):** Before asking for approval, list every step
only the human can do. For each item: what to do, where (URL, UI path, or
command the human runs), and why autopilot needs it. Known categories:

1. **Secrets** the agent must not write into the repo (Actions secrets, org
   secrets, Kody named secrets, deploy tokens). Name each secret and where to
   set it; never ask the human to paste the value into chat.
2. **GitHub App / bot installs** (Cursor Bugbot, CodeRabbit, Devin, Seer, or
   whatever the interview picked for AI review).
3. **Access grants** (app install on the org/repo, OAuth app approval, deploy
   environment reviewers, package registry write, Kody connect).
4. **Host or org settings** the agent cannot change with its credentials (org
   policy, billing, Actions enabled for the repo, workflow permissions that
   require an org admin).
5. **External services** outside the code host (preview/hosting account, error
   tracker webhook, backup target, flag/metrics vendor).

Skip items the audit already shows as done. Say "none" when there are none. Put
the same checklist in the setup PR body (templates → **Setup PR body**).

## 4. Ladder (one setup PR)

Adapt the templates: `npx kcd-skills@latest autopilot templates`.

When at least one plan row lists files, open **exactly one** setup pull request.
That PR carries every file change for every planned rung: workflows, configs,
docs, skills, issue forms, label files, and so on. Do not open a second PR for
leftover files, for `pull_request_target` / `workflow_run` workflows, or for
repo settings. Settings-only rows stay out of the PR and are handled after merge
(or immediately when there is no PR).

**What goes in the PR:** only tracked files. Adapt templates per rung; follow
plan-table **Needs** as the order to write and verify content inside that one PR
(dependency map in `templates`; the `report` plan table shows it).

**What stays out of the PR (agent applies after merge):**

1. **Repo settings that are not files:** branch protection / rulesets, required
   status checks, required reviews, and similar host settings. Apply them with
   the host API (on GitHub: REST/GraphQL via `gh` or the API) right after the
   setup PR merges. Do not open another PR for them.
2. **Required checks:** before merge, ensure each planned required check has a
   default-branch trigger (for example `push`) or another way to run after
   merge. Then wait until each check you will require has run at least once on
   the default branch after the merge (the first post-merge workflow run). Add
   those check names to protection only after that. Requiring a check that has
   never run on the default branch fails or no-ops on some hosts.
3. **Default-branch-only behavior:** workflows that only take effect from the
   default branch (`pull_request_target`, `workflow_run`, some environment
   gates) land as files in the setup PR. After merge, verify they ran or are
   registered as expected. Fix with a normal follow-up change if something is
   wrong; do not open a second "setup" PR just for that.

**Prove it:** once rung 4's files are in the setup (or already on the default
branch), every later product PR is proven locally with the control CLI before
merge: `dev`, then `request --contains` or `execute` (`browse --record` for UI).
Use `preview --pr` only when the change needs a production-like environment;
`health --sha` after deploy. **Testing** cites those commands.

**Who merges the setup PR:** the human always merges it (it changes the gates).
The setup PR itself needs verify + human review. After it merges and rung 6's
ship loop is on the default branch, later product PRs also run the ship loop
until `ready-to-merge` or `parked`.

**Human checklist (after merge):** Apply the post-merge API settings above. Then
re-send the human checklist with only what is still open (secrets still missing,
apps still uninstalled, access still pending). Mark each item done or still
needed; leave nothing implied.

## 5. Hand off

Hand off once the setup PR is merged or open (or was skipped because the plan
was settings-only), post-merge or immediate settings are applied or listed, and
the human checklist is current.

1. Copy `.autopilot/before.json` to `.autopilot/after.json`; re-score rungs the
   setup covered; when there was a setup PR, add `prs` rows that all point at
   it: `{ "rung", "url", "status": "merged|open|parked", "note" }` (same `url`
   for every planned rung; use `note` for post-merge or manual leftovers). For
   settings-only hand-off with no PR, skip `prs` or note that in `note`.
2. Run the verify command and one ship-loop step
   (`npx kcd-skills@latest autopilot ship-pr` or one Kody `tick`) in the target
   repo.
3. Report
   `npx kcd-skills@latest autopilot report .autopilot/after.json --before .autopilot/before.json --html .autopilot/after.html`,
   those results, what you couldn't verify, open decisions, and the outstanding
   human checklist.
