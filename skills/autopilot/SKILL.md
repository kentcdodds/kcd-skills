---
name: autopilot
description:
  Audit any repository and set it up so coding agents ship changes safely with
  little human review. Use when asked to put a repo on autopilot or make it
  agent-ready.
---

# Put this repo on autopilot

Agents ship most changes; the human owns product decisions. Works on any stack.
Every section maps to three pillars plus improvement loops.

## Principles

**P1 Good PRs from the start**

1. The repo tells agents what to build and how to prove it.
2. One small `AGENTS.md` map and one verify command (local == CI).
3. Write down the "no": decisions agents would otherwise re-propose.

**P2 Review, iteration, and verification through CI and previews**

4. Scripts decide anything checkable (audit facts, CI, PR state); agents make
   judgment calls.
5. Never claim what you did not verify. Health checks are not feature tests.

**P3 Limit blast radius when a mistake reaches production**

6. Risky changes ship dark, and recovery is tested.
7. Product calls and one-way doors go to the human.

**KI Keep improving**

8. Agents file friction after every PR; other agents fix it.

## Rules

- Edit nothing until the human approves the plan. One rung per PR, using the
  repo's own tools and layout.
- Stop if the contribution policy rejects agent PRs. In community repos, add
  files; don't rewrite CI.
- For libraries, self-hosted, CLI, and mobile projects, "deploy" means
  "release".
- No secrets in files, issues, or PRs.

## Rungs: done when (audit checklist and ladder)

**P1 Good PRs**

1. Agent map + verify: `AGENTS.md` (or equivalent) is a short map that links to
   the docs owning each task; one verify command CI runs in full.
2. Decisions directory: records of the "no", each with "Revisit if".
3. Primitives catalog: building blocks, code roots, docs.
4. Self-verification: one documented command runs the app and exercises a real
   workflow.
5. PR template: Intent, Why, Door, Cleanup, Testing, System recap.

**P2 Review and verification**

6. Ship loop: Kody `ship-pr` or `ship-pr.mjs` + config, behind a thin `ship-pr`
   skill.
7. Reviewers + previews: AI reviewers per tier, verified previews, agent merge,
   running-version check after deploy.

**P3 Blast radius**

8. Flags + rollback: flags with owner, metric, removal condition; rollback
   runbook.
9. Backups: scheduled, isolated restore test.

**KI Keep improving**

10. Friction form: issue form + `friction`, `friction-skipped` labels, filed by
    every ship loop.
11. Cleanup issues: `Cleanup:` issues with a falsifiable "ready when".
12. Signals + cron agents: friction sweep, errors → issues, docs drift, test
    pruning, legacy reaper.

Order: P1 first (checkable), then P2/P3 (trust), then loops.

## 1. Audit (read only)

Change no tracked files; run no deploy, publish, release, or push. Installing
dependencies is fine. Scripts gather facts; you judge:

```sh
d="${TMPDIR:-/tmp}/autopilot"; mkdir -p "$d"
for f in audit-detect audit-report; do curl -fsSL "https://raw.githubusercontent.com/kentcdodds/kcd-skills/main/skills/autopilot/scripts/$f.mjs" -o "$d/$f.mjs"; done
node "$d/audit-detect.mjs" . --out "$d/before.json"
```

1. **Verify command:** the gate `AGENTS.md` or contributing docs name, else
   `verify.primary`, else each local CI step. Record each by re-running the
   detector with `--verify "<command>"` (it keeps your edits).
2. **Host reads** (read-only `gh` or public API): reviewers and checks on recent
   PRs, labels, `friction` and `Cleanup:` issues. Cite the command as evidence.
3. **Score every rung** against "done when" from evidence, not file names. If
   done needs a command (rung 4, restore test), run `--verify` when it needs no
   secrets; else cap at `partial`. Note what may live outside the repo (NAS,
   Kody jobs).
4. **Report:**
   `node "$d/audit-report.mjs" "$d/before.json" --html "$d/before.html"`. Fix
   every error it lists.

## 2. Interview

Fill defaults from the audit; ask `____ (human)` fields and any blank or
unknown.

```text
Use Kody (https://kody.codes)?   yes (default) | no
P1 Things agents must not do:    ____ (human) 3-5; lens: irreversible, expensive, or user-facing
P2 Agent may merge:              low risk (default) | low+medium | none
P2 Risk tiers:                   low = CI green; medium = +AI reviewer +preview (none: rung 4 script); high = +human
P2 AI reviewers:                 <detected logins/check names, or none> on medium + high
P2 Preview or staging:           <detected | none>
P3 Always human:                 ____ (human) Name the changes that must never ship without you
                                 (e.g. auth, payments, migrations, public API, store releases)
P3 Deploy/release:               <detected>        version check: <url/command>
P3 Flags + metrics source:       <detected | none>
P3 Backups/restore tested:       <detected | unknown>
KI Issue tracker:                <detected>        labels: friction, friction-skipped
```

"Must not do" seeds rung 2; "Always human" defines the high tier. Kody yes/no
paths: **Kody yes / no** in `references/templates.md`.

## 3. Plan

- `missing` or `partial`: one PR that finishes the rung (include findings).
  `done`: none. `unknown`: ask or verify; if still unknown, open question, no
  PR.
- Answers never reorder rungs. A `none` answer (or default) narrows its rung (no
  previews in 7, no flags in 8); inapplicable rungs are `n/a` with `notes` (e.g.
  a library has no backups).
- Add `plan` rows to `before.json` in ladder order:
  `{ "rung", "title", "files": [], "effort": "S|M|L", "door": "two-way|one-way" }`.
  Re-run the report; show the **plan table** and open questions; wait for
  approval.

## 4. Ladder (one PR per rung)

Adapt the templates:
`curl -fsSL https://raw.githubusercontent.com/kentcdodds/kcd-skills/main/skills/autopilot/references/templates.md`
([view](https://github.com/kentcdodds/kcd-skills/blob/main/skills/autopilot/references/templates.md)).

Until rung 6 merges, setup PRs pass verify + human review; after, also run the
ship loop until `ready-to-merge` or `parked`.

**Policy — merge-order dependency map:** Open a rung's PR only after its
plan-table **Needs** have merged; others may run in parallel. Map lives in
`references/templates.md` → **Merge-order dependency map** (drives
`audit-report.mjs`). Edit it there.

**Policy — who merges setup PRs:** The human always merges setup PRs (they
change the gates). Edit this line only if that policy changes.

## 5. Hand off

Hand off once every planned PR is merged or open.

1. Copy `before.json` to `after.json`; re-score merged rungs; add `prs` rows:
   `{ "rung", "url", "status": "merged|open|parked", "note" }`.
2. Run the verify command and `node scripts/ship-pr.mjs --help` (or one Kody
   `tick`) in the target repo.
3. Report
   `node "$d/audit-report.mjs" "$d/after.json" --before "$d/before.json" --html "$d/after.html"`,
   those results, what you couldn't verify, and open decisions.
