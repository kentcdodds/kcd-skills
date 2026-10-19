# KCD Skills

Kent C. Dodds's personal agent skills from
[Kody](https://github.com/kody-hq/kody), shared directly from GitHub and as the
[`kcd-skills`](https://www.npmjs.com/package/kcd-skills) CLI.

Most of these skills are tuned to Kent's tools, accounts, and workflows—the
`ship-pr` skill, for example, posts to Kent's Discord channel through his
private Kody packages. `autopilot` is the exception: it is generic and
stack-agnostic.

You are welcome to fork this repository, use it as inspiration, or install and
modify the skills for your own workflows.

## Install

Install every skill:

```sh
npx skills add kentcdodds/kcd-skills
```

Or install one:

```sh
npx skills add kentcdodds/kcd-skills --skill review-and-recommend
npx skills add kentcdodds/kcd-skills --skill visual-recap
npx skills add kentcdodds/kcd-skills --skill ship-pr
npx skills add kentcdodds/kcd-skills --skill prefer-local-kody-execute
```

Add `--global` to make the skills available across projects.

`autopilot` is a one-off, meant to be used rather than installed. Tell your
agent to run this; it prints the instructions, and the same package runs every
autopilot command:

```sh
npx kcd-skills@latest autopilot
```

## CLI

The `kcd-skills` package holds every skill with its references and scripts, so
one version has all of them. Node 20+, no runtime dependencies.

```sh
npx kcd-skills@latest --help                 # skills and their commands
npx kcd-skills@latest <skill>                # print a skill's instructions
npx kcd-skills@latest autopilot audit . --out .autopilot/before.json
npx kcd-skills@latest autopilot score .autopilot/before.json 1 partial --evidence AGENTS.md --note "why"
npx kcd-skills@latest autopilot finding .autopilot/before.json "text" --rung 1
npx kcd-skills@latest autopilot host request # JSON on stdout; tips on stderr
npx kcd-skills@latest autopilot host .autopilot/before.json --input facts.json
npx kcd-skills@latest autopilot plan add .autopilot/before.json 1 --title "..." --file AGENTS.md --effort S --door two-way
npx kcd-skills@latest autopilot report .autopilot/before.json --html .autopilot/before.html
npx kcd-skills@latest autopilot ship-pr --input state.json --risk low --json
npx kcd-skills@latest autopilot templates    # print a reference
```

Commands work from local files and git. Anything only the code host knows (PR
state, reviews, CI runs, branch rules) comes from the calling agent: the command
prints what it needs and the JSON format (`host request`, `ship-pr --schema`),
and the agent gathers it with whatever tools reach the host. On GitHub,
`ship-pr <pr>` can read the state itself through an authenticated `gh`.

Releases are automatic: every push to `main` runs
[semantic-release](https://semantic-release.gitbook.io/) from conventional
commits and publishes to npm with trusted publishing.

## Skills

- `review-and-recommend` presents decision options with effort, then recommends
  one path and names the right fix.
- `visual-recap` creates and maintains a visual system recap in a pull request.
- `ship-pr` iterates on CI and review feedback until a pull request is ready.
- `prefer-local-kody-execute` prefers `@kodycodes/cli execute --local` over
  hosted MCP `execute` when the agent has shell + Node.
- `autopilot` is a one-off: run `npx kcd-skills@latest autopilot`. It audits any
  repository on any code host against three pillars (good PRs, review and
  verification, limited blast radius) with the CLI's `audit`, `score`, and
  `report` commands, then sets it up so agents ship changes safely: agent
  instructions, decisions, a PR template with a system recap, a deterministic
  ship-PR loop, friction reports, and a maturity ladder. Unlike the other
  skills, it is generic and stack-agnostic. Kody is the recommended default path
  but optional; without Kody the ship loop runs
  `npx kcd-skills autopilot ship-pr`.

`orchestrate` lives in
[kody-hq/kody](https://github.com/kody-hq/kody/tree/main/.agents/skills) (this
repo no longer ships `ask-kent` or `orchestrate`).

These skills use the GitHub CLI and expect it to be authenticated. Some
workflows also use Kent's private Kody packages and project conventions.
