# Setup PR and human checklist

Loaded by `npx kcd-skills@latest autopilot setup-pr` from the plan and ladder
steps of the autopilot skill.

## Human checklist (plan time)

Before asking for approval, list every step only the human can do. For each
item: what to do, where (URL, UI path, or command the human runs), and why
autopilot needs it. Known categories:

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

## Setup PR rules

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
