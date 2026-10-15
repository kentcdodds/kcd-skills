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
npx skills add kentcdodds/kcd-skills --skill review-and-recommend
npx skills add kentcdodds/kcd-skills --skill ship-pr
```

Add `--global` to make the skills available across projects.

`autopilot` is a one-off, meant to be used rather than installed. This prints
its prompt without installing anything:

```sh
npx skills use kentcdodds/kcd-skills@autopilot
```

Add `-a claude-code`, `-a cursor`, or `-a codex` to start that agent with the
prompt.

Or just point your agent at
https://github.com/kentcdodds/kcd-skills/blob/main/skills/autopilot/SKILL.md.

## Skills

- `review-and-recommend` presents decision options with effort, then recommends
  one path and names the right fix.
- `ship-pr` iterates on CI and review feedback until a pull request is ready.
- `autopilot` is a one-off: run `npx skills use kentcdodds/kcd-skills@autopilot`
  (don't install it). It audits any repository and sets it up so agents ship
  changes safely: agent instructions, decisions, a PR template with a system
  recap, a deterministic ship-PR loop, friction reports, and a maturity ladder.
  Unlike the other skills, it is generic and stack-agnostic. Kody is the
  recommended default path but optional; without Kody it copies a portable
  `gh`-based `ship-pr.mjs` into your repo.

Shared Kody skills such as `orchestrate`, `visual-recap`, and
`prefer-local-cli-execute` live in
[kentcdodds/kody](https://github.com/kentcdodds/kody/tree/main/.agents/skills).

These skills use the GitHub CLI and expect it to be authenticated. Some
workflows also use Kent's private Kody packages and project conventions.
