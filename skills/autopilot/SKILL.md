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

Order: P1 makes everything checkable; P2 and P3 earn trust for agent merges;
loops amplify what exists.

## 1. Audit (read only)

Change no tracked files; run no deploy, publish, release, or push step.
Installing dependencies is fine. Scripts gather facts; you judge:

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
3. **Score every rung** against "done when" from the evidence, not file names
   (the detector explains each field). If done hinges on a command working (rung
   4, a restore test), run it with `--verify` if it needs no secrets, else cap
   it at `partial`. Note what may live beyond what you can read (a NAS, Kody
   jobs).
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

"Must not do" seeds rung 2; "Always human" defines the high tier.

**Kody yes** ([connect](https://kody.codes/docs/connect-your-agent.md);
[secrets](https://kody.codes/docs/secrets.md) agents never read,
[jobs](https://kody.codes/docs/triggers.md) for cron agents):
[`@kentcdodds/ship-pr`](https://kody.codes/@kentcdodds/ship-pr) (`tick`) and
[`@kentcdodds/friction-log`](https://kody.codes/@kentcdodds/friction-log) are
**Kent's defaults** (Bugbot/CodeRabbit/Devin/Seer review sort, Discord summary,
daily [`kody-hq/kody`](https://github.com/kody-hq/kody) sweep): a template to
fork and reconfigure for your stack, not the only way. **Kody no:**
`curl -fsSL https://raw.githubusercontent.com/kentcdodds/kcd-skills/main/skills/autopilot/scripts/ship-pr.mjs -o scripts/ship-pr.mjs`
(use the repo's script folder), write `.github/ship-pr.json` from this form, and
use the issue form and CI cron.

## 3. Plan

- `missing` or `partial`: one PR that finishes the rung, including its findings.
  `done`: none. `unknown`: ask or verify; if still unknown, it's an open
  question with no PR.
- Answers never reorder rungs. A `none` answer (or default) narrows its rung's
  PR (no previews in rung 7, no flags in rung 8); a rung that can't apply is
  `n/a` with the reason in `notes` (a library has no backups).
- Add `plan` rows to `before.json` in ladder order:
  `{ "rung", "title", "files": [], "effort": "S|M|L", "door": "two-way|one-way" }`.
  Re-run the report and show its **plan table** and open questions. Wait for
  approval.

## 4. Ladder (one PR per rung)

Adapt the templates:
`curl -fsSL https://raw.githubusercontent.com/kentcdodds/kcd-skills/main/skills/autopilot/references/templates.md`
([view](https://github.com/kentcdodds/kcd-skills/blob/main/skills/autopilot/references/templates.md)).

- Open a rung's PR once its plan-table **Needs** merged; others may run in
  parallel (after rung 1: 2–5, 8, 9). Later rungs build on earlier files;
  stacked unmerged PRs mean rebases and broken links.
- Until rung 6 merges, setup PRs pass the verify command and human review;
  after, also run the ship loop on each until `ready-to-merge` or `parked`. The
  human merges setup PRs: they change the gates themselves.

## 5. Hand off

Hand off once every planned PR is merged or open.

1. Copy `before.json` to `after.json`; re-score merged rungs; add `prs` rows:
   `{ "rung", "url", "status": "merged|open|parked", "note" }`.
2. Run the verify command and `node scripts/ship-pr.mjs --help` (or one Kody
   `tick`) in the target repo.
3. Report
   `node "$d/audit-report.mjs" "$d/after.json" --before "$d/before.json" --html "$d/after.html"`,
   those results, what you couldn't verify, and open decisions.
