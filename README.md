# KCD Skills

Kent C. Dodds's personal agent skills from
[Kody](https://github.com/kentcdodds/kody), shared directly from GitHub.

These skills are specific to Kent's tools, accounts, and workflows. They are
not intended to be generic or work for everyone as-is—the `ship-pr` skill, for
example, posts to Kent's Discord channel through his private Kody packages.

You are welcome to fork this repository, use it as inspiration, or install and
modify the skills for your own workflows.

## Install

Install both skills:

```sh
npx skills add kentcdodds/kcd-skills
```

Or install one:

```sh
npx skills add kentcdodds/kcd-skills --skill visual-recap
npx skills add kentcdodds/kcd-skills --skill ship-pr
```

Add `--global` to make the skills available across projects.

## Skills

- `visual-recap` creates and maintains a visual system recap in a pull request.
- `ship-pr` iterates on CI and review feedback until a pull request is ready.

These skills use the GitHub CLI and expect it to be authenticated. Some
workflows also use Kent's private Kody packages and project conventions.
