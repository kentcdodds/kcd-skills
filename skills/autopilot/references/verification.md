# Verification: a project control CLI + skill (rung 4)

Verification is the biggest lever on autopilot. An agent that can start the app,
sign in, assert on real responses, and watch a real browser proves its own PRs.
One that cannot falls back to "CI is green" and hand-written curl.

Rung 4 is done when the repo has:

1. A **project control CLI** (`control-<project>`): one entry point that drives
   the real app.
2. A **`control-<project>` agent skill** that tells agents to use the CLI
   instead of throwaway scripts.
3. A **Feature Map**: a catalog of the app's surfaces that `map --check` keeps
   honest, refreshed by a scheduled agent.

## The model: Kody's `control-kody`

Kent's default, a shape to copy and fork, not a requirement:

- CLI:
  [`tools/control-kody.ts`](https://github.com/kody-hq/kody/blob/main/tools/control-kody.ts)
  (run as `npm run control-kody -- <command>`)
- Skill:
  [`.agents/skills/control-kody/SKILL.md`](https://github.com/kody-hq/kody/blob/main/.agents/skills/control-kody/SKILL.md)
- Docs:
  [`docs/contributing/control-kody.md`](https://github.com/kody-hq/kody/blob/main/docs/contributing/control-kody.md)

Commands to build (control-kody's names and flags; keep them so agents that know
one repo know yours):

| Command                                                  | What it proves                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`                                                 | The environment works: runtime, browsers, git hooks, installed deps, `/health`, local database. Prints the fix for each failure. It checks; it does not start anything.               |
| `dev`                                                    | Starts the local app, or reuses one that is already running and healthy. Prints the origin.                                                                                           |
| `login`                                                  | A real session as a seed user, written to a cookie file bound to that origin.                                                                                                         |
| `request METHOD /path [--dump] [--contains <text>]`      | Authenticated HTTP as that session. `--contains` fails unless the body has the text; `--dump` saves the raw body. No hand-written curl, and never paste the cookie into another tool. |
| `preview --pr <n> [--request '<spec>'] [--check <path>]` | The same assertions against the PR's preview deploy, as the preview seed user.                                                                                                        |
| `health [--origin <url>] --sha <sha>`                    | The running version is the merge you expect (full or unique short SHA).                                                                                                               |
| `browse --origin <url> --path <path> [--record]`         | Real browser proof: signed-in Playwright Chromium at that path; `--record` saves a video. Use only when UI is under test; prefer `request` otherwise.                                 |
| `map [<feature>]`, `map --check`                         | Lists or prints a Feature Map entry; `--check` (and a test) fail when the catalog drifts from the routes.                                                                             |

Add domain commands as you need them (control-kody also has `package-create`,
`execute`, and `search` for preview fixtures). `--json` on every command gives
agents machine-readable output.

Seed users use public test credentials only. No secrets in the CLI, the skill,
or PRs.

## The skill

`.agents/skills/control-<project>/SKILL.md` (or your agent's skills folder):

- Opens with "do not invent a throwaway curl script; use the CLI and the Feature
  Map."
- One code block listing every command with a realistic example.
- Seed users per environment, what they can and cannot reach (admin pages,
  flags).
- A **Proof** section (below), so CI green is never mistaken for proof.

## Feature Map

A human index (Kody:
`.agents/skills/control-kody/references/features/README.md`, one file per
surface) plus a machine-readable catalog (Kody:
[`tools/control-kody/feature-catalog.ts`](https://github.com/kody-hq/kody/blob/main/tools/control-kody/feature-catalog.ts)).
Agents load one feature file for the surface they change. `map --check` fails
when a listed path leaves the router or a required route has no entry; run it in
CI.

Keep it fresh with a scheduled agent. Kody's is
`@kentcdodds/verification-skill-maintain`, a Kody job that runs daily at 06:00
America/Denver, scans the Feature Map on `main`, and spawns one Cursor Cloud
Agent when the catalog is stale or a route is unmapped. The agent updates the
map and ships it through `ship-pr` for low or medium risk (described in
[control-kody.md → Daily garden](https://github.com/kody-hq/kody/blob/main/docs/contributing/control-kody.md#daily-garden)).
**Kody no:** a scheduled CI workflow that runs `map --check` and launches your
coding agent when it fails. This is one of the rung 12 cleanup automations.

## Proof in the ship loop

Before merge, the agent proves its PR on the preview with the control CLI:

1. `doctor`, then `dev` (local) or `preview --pr <n>`.
2. `request ... --contains <text>` or `preview --pr <n> --check <path>` as the
   seed user, with data for this change.
3. UI under test: `browse --origin <preview> --path <path> --record`.
4. After merge: `health --origin <prod> --sha <merge-sha>`.

The PR template's **Testing** section cites the exact commands and results (and
the `--record` video when UI changed). The ship loop's medium tier "+preview"
means this proof, not "a preview exists". Without previews, run the same
commands against `dev`.

## Not a web app?

The same rung applies; only the harness changes. CLIs and TUIs: drive the binary
with a PTY or tmux harness. Desktop or Electron: a CDP harness. Starters: Cursor
Team Kit's
[`control-cli`](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/control-cli/SKILL.md)
and
[`control-ui`](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/control-ui/SKILL.md)
skills. Libraries: `doctor` plus a script that exercises the public API from a
packed build.
