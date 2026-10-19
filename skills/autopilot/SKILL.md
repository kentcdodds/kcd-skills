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

- Start editing once the human approves the plan. One rung per PR, using the
  repo's own tools and layout.
- Follow the contribution policy; stop if it excludes agent PRs. In community
  repos, add files and keep the existing CI.
- For libraries, self-hosted, CLI, and mobile projects, "deploy" means
  "release".
- Keep secrets out of files, issues, and PRs.

## Rungs: done when (audit checklist and ladder)

**P1 Good PRs**

1. Agent map + verify: a short `AGENTS.md` (or equivalent) linking the docs
   agents use; one verify command (tests, typecheck where the language has one,
   lint, format) CI runs in full. Commit and pre-push hooks run the fast static
   checks (lint, format, typecheck, dead-code checks); CI time budgets fail only
   on real problems.
2. Decisions directory: ADRs for multi-PR decisions and the "no", each with
   "Revisit if".
3. Primitives catalog: building blocks and code roots, kept short.
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
    call. Default: `P0`–`P3` labels + `needs-decision`; the team's own scheme
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
KI Priority + decisions:         <detected | P0–P3 + needs-decision (default)>  How does the team rank work
                                 and flag decisions? (labels, project-board field, tracker priority field, nothing)
```

"Must not do" seeds rung 2; "Always human" defines the high tier. "Priority +
decisions" sets rung 11: `npx kcd-skills@latest autopilot triage request` prints
the format; record it with
`npx kcd-skills@latest autopilot triage .autopilot/before.json --input triage.json`.
Kody yes/no paths: **Kody yes / no** in
`npx kcd-skills@latest autopilot templates`.

## 3. Plan

- `missing` or `partial`: one PR that finishes the rung (include findings).
  `done`: none. `unknown`: ask or verify; if still unknown, open question, no
  PR.
- Rungs keep ladder order whatever the answers. A `none` answer (or default)
  narrows its rung (no previews in 7, no flags in 8); inapplicable rungs are
  `n/a` with `notes` (e.g. a library has no backups).
- Add one plan row per PR:
  `npx kcd-skills@latest autopilot plan add .autopilot/before.json <rung> --title "<title>" --file <path> --effort S|M|L --door two-way|one-way`
  (repeat `--file`; rows stay in ladder order). Re-run the report; show the
  **plan table** and open questions; wait for approval.

## 4. Ladder (one PR per rung)

Adapt the templates: `npx kcd-skills@latest autopilot templates`.

Until rung 6 merges, setup PRs pass verify + human review; after, also run the
ship loop until `ready-to-merge` or `parked`.

**Prove it:** once rung 4 lands, every PR is proven locally with the control CLI
before merge: `dev`, then `request --contains` or `execute` (`browse --record`
for UI). Use `preview --pr` only when the change needs a production-like
environment; `health --sha` after deploy. **Testing** cites those commands.

**Policy — merge-order dependency map:** Open a rung's PR only after its
plan-table **Needs** merge; others may run in parallel. The map is **Merge-order
dependency map** in `templates`; the `report` plan table uses it.

**Policy — who merges setup PRs:** The human always merges setup PRs (they
change the gates). Edit only if that policy changes.

## 5. Hand off

Hand off once every planned PR is merged or open.

1. Copy `.autopilot/before.json` to `.autopilot/after.json`; re-score merged
   rungs; add `prs` rows:
   `{ "rung", "url", "status": "merged|open|parked", "note" }`.
2. Run the verify command and one ship-loop step
   (`npx kcd-skills@latest autopilot ship-pr` or one Kody `tick`) in the target
   repo.
3. Report
   `npx kcd-skills@latest autopilot report .autopilot/after.json --before .autopilot/before.json --html .autopilot/after.html`,
   those results, what you couldn't verify, and open decisions.
