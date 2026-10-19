# Verification: a project control CLI + skill (rung 4)

What helps agents ship quality, in order: unit and integration test suites,
typecheck, agents running their own change, a control CLI to drive the app,
end-to-end tests, and decision records. Rung 1 covers tests and typecheck; this
rung makes running the change part of every PR. An agent that starts the app,
signs in, and asserts on real responses catches its own bugs before merge.

Rung 4 is done when the repo has:

1. A **project control CLI** (`control-<project>`): one entry point that drives
   the real app, locally by default.
2. A **`control-<project>` agent skill** that points agents at the CLI for every
   check.
3. For apps with routes, a **Feature Map** generated from the framework's own
   route list, plus short notes on how to seed and reach each page and its
   actions. `map --check` runs in CI on every PR.

## Local first, previews for production-like checks

Verify locally: `dev`, then `request`, `execute`, and `browse` against it. Use a
preview deploy when the change needs a production-like environment:

- Platform bindings (queues, storage, workers, edge runtime).
- Durable state (migrations, long-lived objects, data in real storage).
- Real OAuth, webhooks, or third-party callbacks.
- Deploy and config (build settings, env vars, routing, headers).

## The model: Kody's `control-kody`

Kent's default, a shape to copy and fork:

- CLI:
  [`tools/control-kody.ts`](https://github.com/kody-hq/kody/blob/main/tools/control-kody.ts)
- Skill:
  [`.agents/skills/control-kody/SKILL.md`](https://github.com/kody-hq/kody/blob/main/.agents/skills/control-kody/SKILL.md)
- Docs:
  [`docs/contributing/control-kody.md`](https://github.com/kody-hq/kody/blob/main/docs/contributing/control-kody.md)

Commands to build (control-kody's names and flags; keep them so agents that know
one repo know yours):

| Command                                                  | What it proves                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`                                                 | The environment works: runtime, browsers, git hooks, installed deps, `/health`, local database. Prints the fix for each failure. Read-only.             |
| `dev`                                                    | Starts the local app, or reuses one that is already running and healthy. Prints the origin.                                                             |
| `login`                                                  | A real session as a seed user, written to a cookie file bound to that origin.                                                                           |
| `request METHOD /path [--dump] [--contains <text>]`      | Authenticated HTTP as that session. `--contains` fails unless the body has the text; `--dump` saves the raw body. The session stays inside the CLI.     |
| `execute --code-file <file> [--origin <url>]`            | Runs a fixture through the app's own API as the seed user: seed data for this change, or assert behavior without the UI.                                |
| `browse [--origin <url>] --path <path> [--record]`       | Real browser proof: a signed-in browser at that path; `--record` saves a video. For changes with UI under test; `request` and `execute` cover the rest. |
| `map [<feature>]`, `map --check`                         | Prints a feature's seed-and-reach notes; `--check` (and a test) fail when the notes drift from the framework's route list.                              |
| `preview --pr <n> [--request '<spec>'] [--check <path>]` | The same assertions against the PR's preview deploy, as the preview seed user. For production-like changes (above).                                     |
| `health [--origin <url>] --sha <sha>`                    | The running version is the merge you expect (full or unique short SHA).                                                                                 |

Add domain commands as you need them (control-kody also has `package-create` and
`search`). `--json` on every command gives agents machine-readable output.

Seed users use public test credentials, and secrets stay out of the CLI, the
skill, and PRs.

## The skill

`.agents/skills/control-<project>/SKILL.md` (or your agent's skills folder):

- Opens with "use the CLI for every check of the running app."
- One code block listing every command with a realistic example, local first.
- Seed users per environment, what they can reach (admin pages, flags).
- When to reach for a preview (the production-like list above).
- A **Proof** section (below).

Keep it lean: the sections agents cite in **Testing** are the ones that matter.

## Feature Map

Generate the route index from the framework's own route list (a generated route
tree, route manifest, or the server's route table), so it is always current.

Add notes where they help verification: how to seed and reach each page, and its
actions (forms and the API routes it calls). Agents load the note for the
surface they change. `map --check` fails when a note points at a route the route
list no longer has, or a route that needs seeding has no note; cover API routes
as well as pages. CI runs it on every PR.

## Proof in the ship loop

Before merge, the agent proves its PR with the control CLI, locally by default:

1. Add or update the test that covers the change; run it with typecheck.
2. `doctor`, then `dev`.
3. `request ... --contains <text>` or `execute --code-file <fixture>` as the
   seed user, with data for this change.
4. UI under test: `browse --path <path> --record`.
5. Production-like changes: `preview --pr <n> --request '<spec>'` or
   `--check <path>`, and `browse --origin <preview>` for UI.
6. After merge: `health --origin <prod> --sha <merge-sha>`.

The PR template's **Testing** section cites the exact commands and results (and
the `--record` video when UI changed). The ship loop's medium-tier proof is
these commands.

Reviewers (AI and human) check every changed test expectation against the PR's
intent. When a PR changes an assertion alongside the code it tests, the PR body
says why.

## Other kinds of projects

The same rung applies with a different harness. CLIs and TUIs: drive the binary
with a PTY or tmux harness. Desktop apps: a browser-protocol or accessibility
harness. Starters: Cursor Team Kit's
[`control-cli`](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/control-cli/SKILL.md)
and
[`control-ui`](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/control-ui/SKILL.md)
skills. Libraries: `doctor` plus a script that exercises the public API from a
packaged build. The Feature Map is for apps with routes.
