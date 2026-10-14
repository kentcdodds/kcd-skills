# KCD Skills

Kent C. Dodds's personal agent skills from
[Kody](https://github.com/kentcdodds/kody), shared directly from GitHub.

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
npx skills add kentcdodds/kcd-skills --skill ask-kent
npx skills add kentcdodds/kcd-skills --skill review-and-recommend
npx skills add kentcdodds/kcd-skills --skill orchestrate
npx skills add kentcdodds/kcd-skills --skill visual-recap
npx skills add kentcdodds/kcd-skills --skill ship-pr
npx skills add kentcdodds/kcd-skills --skill prefer-local-kody-execute
```

Add `--global` to make the skills available across projects.

`autopilot` is a one-off, meant to be used rather than installed. This prints
its prompt without installing anything:

```sh
npx skills use kentcdodds/kcd-skills@autopilot
```

Or just point your agent at
https://github.com/kentcdodds/kcd-skills/blob/main/skills/autopilot/SKILL.md.

## Skills

- `ask-kent` is the router: describe the situation, get the next `/skill` to
  type. It recommends and stops.
- `review-and-recommend` presents decision options with effort, then recommends
  one path and names the right fix.
- `orchestrate` coordinates sub-agents for large tasks (plan, delegate, review,
  integrate). Not Cursor's cloud-agent `/orchestrate` plugin.
- `visual-recap` creates and maintains a visual system recap in a pull request.
- `ship-pr` iterates on CI and review feedback until a pull request is ready.
- `prefer-local-kody-execute` prefers `@kodycodes/cli execute --local` over
  hosted MCP `execute` when the agent has shell + Node.
- `autopilot` is a one-off: run `npx skills use kentcdodds/kcd-skills@autopilot`
  (don't install it). It audits any repository and sets it up so agents ship
  changes safely: agent instructions, decisions, a PR template with a system
  recap, a deterministic ship-PR loop, friction reports, and a maturity ladder.
  Unlike the other skills, it is generic and stack-agnostic. Kody is the
  recommended default path but optional; without Kody it copies a portable
  `gh`-based `ship-pr.mjs` into your repo.

These skills use the GitHub CLI and expect it to be authenticated. Some
workflows also use Kent's private Kody packages and project conventions.
