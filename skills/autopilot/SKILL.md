---
name: autopilot
description:
  Audit any repository and set it up so coding agents ship changes safely with
  little human review. Use when asked to put a repo on autopilot or make it
  agent-ready.
---

# Put this repo on autopilot

Agents ship most changes; the human owns product decisions. Works on any stack.

## Principles

1. **Good PRs:** the repo tells agents what to build and how to prove it.
2. **Catch mistakes:** a deterministic loop, not a prompt, decides when a PR is
   done.
3. **Limit blast radius:** risky changes ship dark, and recovery is tested.
4. One small `AGENTS.md` map and one verify command (local == CI).
5. Write down the "no": decisions agents would otherwise re-propose.
6. Never claim what you did not verify. Health checks are not feature tests.
7. Agents file friction after every PR; other agents fix it.
8. Product calls and one-way doors go to the human.

## Rules

- Edit nothing until the human approves the plan. One rung per PR, using the
  repo's own tools and layout.
- Stop if the contribution policy rejects agent PRs. In community repos, add
  files; don't rewrite CI.
- For libraries, self-hosted, CLI, and mobile projects, "deploy" means
  "release".
- No secrets in files, issues, or PRs.

## 1. Audit (read only)

With paths, record: stack, agent files, verify commands (run them), CI,
previews, deploy, templates, review bots, ADRs, flags, backups, schedules. Score
each rung: done, partial, missing, or unknown.

## 2. Interview

Show this form with detected defaults; ask only about blanks.

```text
Use Kody (https://kody.codes)?     yes (default) | no
Agent may merge:                   low risk (default) | low+medium | none
Risk tiers:                        low = CI green; medium = +AI reviewer +preview; high = +human
Always human:                      auth, payments, migrations, public API, store releases
AI reviewers per tier:             <detected logins/check names, or none>
Deploy/release:                    <detected>        version check: <url/command>
Preview or staging:                <detected | none>
Issue tracker:                     <detected>        labels: friction, friction-skipped
Flags + metrics source:            <detected | none>
Backups/restore tested:            unknown
3-5 things agents must not do:     ____
```

**Kody** ([connect over MCP](https://kody.codes/docs/connect-your-agent.md)):
[secrets](https://kody.codes/docs/secrets.md) agents use but never read, and
[jobs/webhooks](https://kody.codes/docs/triggers.md) for cron and signal agents.
[`@kentcdodds/ship-pr`](https://kody.codes/@kentcdodds/ship-pr) (`tick`) and
[`@kentcdodds/friction-log`](https://kody.codes/@kentcdodds/friction-log) are
Kent's public packages with his defaults (Bugbot/CodeRabbit/Devin/Seer review
sort, Discord summary, daily `kentcdodds/kody` sweep); fork and configure them.
**No Kody:** copy
[`ship-pr.mjs`](https://github.com/kentcdodds/kcd-skills/blob/main/skills/autopilot/scripts/ship-pr.mjs)
into the repo
(`curl -fsSL https://raw.githubusercontent.com/kentcdodds/kcd-skills/main/skills/autopilot/scripts/ship-pr.mjs -o scripts/ship-pr.mjs`;
use the repo's script folder), write `.github/ship-pr.json` from this form, and
use the issue form and CI cron.

## 3. Plan

List PRs in ladder order, skipping done rungs, with files, effort, and door.
Wait for approval.

## 4. Ladder (one PR per rung)

Fetch and adapt the templates:
`curl -fsSL https://raw.githubusercontent.com/kentcdodds/kcd-skills/main/skills/autopilot/references/templates.md`
([view](https://github.com/kentcdodds/kcd-skills/blob/main/skills/autopilot/references/templates.md)).

**Pillar 1: good PRs**

1. `AGENTS.md` map + one verify command in CI.
2. Decisions directory seeded from the interview.
3. Primitives catalog: building blocks, code roots, docs.
4. Self-verification script that runs the app and exercises a workflow.
5. PR template: Intent, Why, Door, Cleanup, Testing, System recap.

**Pillar 2: catch mistakes**

6. Ship loop: Kody `ship-pr` or `scripts/ship-pr.mjs` + `.github/ship-pr.json` +
   a thin `ship-pr` skill. Prose loops wander.
7. AI reviewers + preview verification, then agent merge + deploy watch (check
   the running version).

**Pillar 3: limit blast radius**

8. Flags with owner, success metric, removal condition; rollback runbook.
9. Backups with a scheduled, isolated restore test.

**Then: keep improving**

10. Friction issue form + labels, filed at the end of every ship loop.
11. `Cleanup:` issues with a falsifiable "ready when".
12. Signal pipelines + cron agents: friction sweep, errors → issues, docs drift,
    test pruning, legacy reaper.

Order: good PRs make everything checkable; gates and safeguards earn trust for
agent merges; loops come last because they amplify what exists.

## 5. Hand off

Run the new verify command and the copied script's `--help` in the target repo
(e.g. `node scripts/ship-pr.mjs --help`), or one Kody `tick`, once. Report their
results, rung scores before/after, PRs opened, what you couldn't verify, and
open decisions.
