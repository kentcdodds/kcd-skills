---
name: ship-pr
description: >
  Babysit a PR to done with the @kentcdodds/ship-pr Kody package: tick the PR,
  read the focused step, fix / reply / decide, and tick again until done (merge
  or park, deploy, leftover friction, summary). Use when a pull request needs to
  be shepherded to done.
---

# Ship PR

When a pull request needs to be shepherded to done. The loop is the Kody package
[`@kentcdodds/ship-pr`](https://kody.codes/@kentcdodds/ship-pr)
(`search({ entity: "package:@kentcdodds/ship-pr" })`). Its `tick` export reports
where the PR stands and the one step to focus on; you act and tick again.
Without Kody, `npx kcd-skills@latest autopilot ship-pr` runs the same loop.

Pass `risk` on every tick. User policy overrides.

- **low:** green CI. AI review is optional.
- **medium:** wait for Bugbot. Handle valid feedback. When `triggerBugbot`
  returns `github_account_mismatch`, continue with CI alone; Bugbot will not
  review that PR.
- **high:** also wait for CodeRabbit and Devin. Park unless `mergeAuthority` is
  true.

Credential setup is
[prefer-local-kody-execute](../prefer-local-kody-execute/SKILL.md).

## Command

Run each export through a one-line static import; `exampleInvokes` in tick
output already uses this form. The first tick is full. Re-ticks pass
`brief: true`.

```bash
npx @kodycodes/cli execute --local \
  --code 'import run from "kody:@kentcdodds/ship-pr/tick"; export default (p) => run(p)' \
  --params '{"prUrl":"https://github.com/owner/repo/pull/123","risk":"medium","applySafeAutomations":true}'
```

## Acting on a tick

- `exit.status` is `waiting`: end the turn with a wake armed. Subscribe to CI
  when waiting on CI, and always set a one-shot timer from `exit.wakeHints`
  (name, `delaySeconds`, `prompt`); a CI subscription alone can miss its
  delivery. On wake, re-tick and re-arm from the new `exit.wakeHints` while it
  still says `waiting`. Soak, parity, and calendar gates work the same way.
- A valid finding: fix, push, and `./reply-review` with `Fixed in <sha>: ...`.
- A check or finding you will not fix: `./decide` with a reason (`ignored`,
  `skipped`, `wontfix`, or `accepted`).
- Focus `merge`: `./merge`. Focus `friction`:
  [friction-log](../friction-log/SKILL.md). Focus `report`: the printed
  `./send-summary`, with `agentId` and `model` from your agent runtime (omit
  `model` when it has none) and verified deployed page links in `extras`.
- Medium or high risk: prove the change locally with the project's control CLI
  or skill before merge, and use a PR preview when local cannot exercise it.
  Non-trivial PR descriptions carry a system recap
  ([visual-recap](../visual-recap/SKILL.md)).
- Scrutinize test-expectation changes made in the same PR as the code they test;
  each one needs a reason from the intended behavior.
