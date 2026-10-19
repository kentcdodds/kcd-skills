# Verification: a project control CLI + skill (rung 4)

What helps agents ship quality, in order: unit and integration test suites,
typecheck, agents running their own change, a control CLI to drive the app,
end-to-end tests, and decision records. Rung 1 covers tests and typecheck; this
rung makes "run your own change" the default. An agent that starts the app,
signs in, and asserts on real responses catches its own bugs before merge. One
that cannot falls back to "CI is green" and hand-written curl.

Rung 4 is done when the repo has:

1. A **project control CLI** (`control-<project>`): one entry point that drives
   the real app, locally by default.
2. A **`control-<project>` agent skill** that tells agents to use the CLI
   instead of throwaway scripts.
3. For apps with routes, a **Feature Map** generated from the router, plus short
   notes on how to seed and reach each page and its actions. `map --check` runs
   in CI on every PR.

## Local first, previews when production-like

Verify locally: `dev`, then `request`, `execute`, and `browse` against it. Use a
preview deploy only when the change needs a production-like environment:

- Platform bindings (queues, storage, workers, edge runtime).
- Durable state (migrations, long-lived objects, data shape in real storage).
- Real OAuth, webhooks, or third-party callbacks.
- Deploy and config (build settings, env vars, routing, headers).

Everything else is faster, cheaper, and just as convincing on `dev`.

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
| `execute --code-file <file> [--origin <url>]`            | Runs a fixture through the app's own API as the seed user: seed data for this change, or assert behavior without the UI.                                                              |
| `browse [--origin <url>] --path <path> [--record]`       | Real browser proof: signed-in Playwright Chromium at that path; `--record` saves a video. Use only when UI is under test; prefer `request` or `execute` otherwise.                    |
| `map [<feature>]`, `map --check`                         | Prints a feature's seed-and-reach notes; `--check` (and a test) fail when the notes drift from the generated route tree.                                                              |
| `preview --pr <n> [--request '<spec>'] [--check <path>]` | The same assertions against the PR's preview deploy, as the preview seed user. Only for production-like changes (above).                                                              |
| `health [--origin <url>] --sha <sha>`                    | The running version is the merge you expect (full or unique short SHA).                                                                                                               |

Add domain commands as you need them (control-kody also has `package-create` and
`search`). `--json` on every command gives agents machine-readable output.

Seed users use public test credentials only. No secrets in the CLI, the skill,
or PRs.

## The skill

`.agents/skills/control-<project>/SKILL.md` (or your agent's skills folder):

- Opens with "do not invent a throwaway curl script; use the CLI."
- One code block listing every command with a realistic example, local first.
- Seed users per environment, what they can and cannot reach (admin pages,
  flags).
- When to reach for a preview (the production-like list above).
- A **Proof** section (below), so CI green is never mistaken for proof.

Keep it lean. It earns its place when agents cite it in **Testing**; cut
sections they never use.

## Feature Map

Generate the route index from the router's source of truth (TanStack Router's
generated `routeTree.gen.ts`, a framework route manifest, or the server's route
table). Never hand-maintain a list of paths: a hand-kept list mirrors the
router, costs a diff in every UI change, and can stay "fresh" while a route
breaks.

Write notes only where they help verification: how to seed and reach each page,
and its actions (forms, JSON or API routes it calls). Agents load the note for
the surface they change. `map --check` fails when a note points at a route the
generated tree no longer has, or a route that needs seeding has no note; cover
JSON and API routes, not just pages. CI runs it on every PR, so it needs no
scheduled job.

## Proof in the ship loop

Before merge, the agent proves its PR with the control CLI, locally by default:

1. Add or update the test that covers the change; run it with typecheck.
2. `doctor`, then `dev`.
3. `request ... --contains <text>` or `execute --code-file <fixture>` as the
   seed user, with data for this change.
4. UI under test: `browse --path <path> --record`.
5. Production-like changes only: `preview --pr <n> --request '<spec>'` or
   `--check <path>`, and `browse --origin <preview>` for UI.
6. After merge: `health --origin <prod> --sha <merge-sha>`.

The PR template's **Testing** section cites the exact commands and results (and
the `--record` video when UI changed). The ship loop's medium tier proof means
these commands, not "a preview exists".

Reviewers (AI and human) check every changed test expectation against the PR's
intent. An assertion rewritten in the same PR as the code it tests can lock in a
wrong change; it needs a reason in the PR body.

## Not a web app?

The same rung applies; only the harness changes. CLIs and TUIs: drive the binary
with a PTY or tmux harness. Desktop or Electron: a CDP harness. Starters: Cursor
Team Kit's
[`control-cli`](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/control-cli/SKILL.md)
and
[`control-ui`](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/control-ui/SKILL.md)
skills. Libraries: `doctor` plus a script that exercises the public API from a
packed build. No routes means no Feature Map.
