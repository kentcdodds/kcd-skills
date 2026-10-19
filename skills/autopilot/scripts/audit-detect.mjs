#!/usr/bin/env node
// Prefill an autopilot audit JSON with facts a script can check: stack, CI
// steps, verify command, evidence paths per rung, and deterministic findings.
// Scores and notes stay empty: the agent judges them. Read only, except for
// commands passed with --verify (recorded with exit code and output tail).
// Re-running with --out keeps the agent's score, notes, inferred, and
// evidence/checked entries already in that file.
import { execFileSync, spawnSync } from 'node:child_process'
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep in sync with audit-report.mjs (a test checks this).
export const rungs = [
	{ id: 1, pillar: 'good-prs', name: 'Agent map + one verify command in CI' },
	{ id: 2, pillar: 'good-prs', name: 'Decisions directory' },
	{ id: 3, pillar: 'good-prs', name: 'Primitives catalog' },
	{ id: 4, pillar: 'good-prs', name: 'Self-verification: control CLI + skill' },
	{ id: 5, pillar: 'good-prs', name: 'PR template' },
	{ id: 6, pillar: 'review', name: 'Ship loop' },
	{
		id: 7,
		pillar: 'review',
		name: 'AI reviewers, previews, agent merge, deploy watch',
	},
	{ id: 8, pillar: 'blast-radius', name: 'Flags + rollback runbook' },
	{ id: 9, pillar: 'blast-radius', name: 'Backups + tested restore' },
	{ id: 10, pillar: 'improve', name: 'Friction form' },
	{ id: 11, pillar: 'improve', name: 'Triage: priority + decision marker' },
	{ id: 12, pillar: 'improve', name: 'Cleanup issues' },
	{ id: 13, pillar: 'improve', name: 'Signals + cleanup cron agents' },
]

const ignoredDirs = new Set([
	'.git',
	'node_modules',
	'dist',
	'build',
	'vendor',
	'target',
	'.venv',
	'venv',
	'__pycache__',
	'.next',
	'coverage',
])

// Rung 4: a project control CLI (tools/control-kody.ts shape), its skill, and
// a Feature Map. Each is checked on its own.
const controlCliPathPattern =
	/^(tools|scripts|bin)\/control[-_][^/]+$|^bin\/control$/i
const controlSkillPathPattern =
	/^\.(agents|cursor|claude|codex)\/skills\/control-[^/]+\/SKILL\.md$/i
const featureMapPathPattern =
	/(^|\/)feature[-_](catalog|map)\.[a-z]+$|^\.(agents|cursor|claude|codex)\/skills\/control-[^/]+\/references\/features\/README\.md$/i
const controlScriptPattern = /^control([-:_]|$)/i

// Per rung: [label, path regex] pairs. A match becomes evidence.
const pathRules = {
	1: [
		[
			'agent instructions (AGENTS.md, CLAUDE.md, .cursor/rules, copilot-instructions.md)',
			/(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$|^\.cursorrules$|^\.cursor\/rules\/|^\.github\/copilot-instructions\.md$|^\.windsurfrules$|^\.clinerules/i,
		],
		[
			'CI config (.github/workflows, .gitlab-ci.yml, .circleci, Jenkinsfile, ...)',
			/^\.github\/workflows\/[^/]+\.ya?ml$|^\.gitlab-ci\.ya?ml$|^\.circleci\/config\.ya?ml$|^azure-pipelines\.ya?ml$|^Jenkinsfile$|^\.buildkite\/|^bitbucket-pipelines\.ya?ml$|^\.travis\.ya?ml$|^\.woodpecker/,
		],
	],
	2: [
		[
			'decision records (decisions/, adr/, adrs/)',
			/(^|\/)(decisions|adrs?|architecture-decisions)\/[^/]+\.md$/i,
		],
	],
	3: [
		[
			'primitives or architecture doc (*primitive*, *architecture*, *catalog*)',
			/(^|\/)[^/]*(primitive|architecture|building-blocks|catalog)[^/]*\.mdx?$/i,
		],
	],
	4: [
		[
			'e2e or self-verify config (playwright, cypress, *smoke*, *self-verify*)',
			/(^|\/)(playwright|cypress)[^/]*\.(config\.)?[cm]?[jt]s$|(^|\/)[^/]*(smoke|self-verify|verify-app)[^/]*\.[a-z]+$/i,
		],
		[
			'project control CLI (tools/control-*.ts, scripts/control-*, bin/control-*)',
			controlCliPathPattern,
		],
		[
			'control skill (.agents/skills/control-*/SKILL.md)',
			controlSkillPathPattern,
		],
		[
			'Feature Map (feature-catalog.*, feature-map.*, skills/control-*/references/features/README.md)',
			featureMapPathPattern,
		],
	],
	5: [
		[
			'PR template (pull_request_template.md, PULL_REQUEST_TEMPLATE/, merge_request_templates/)',
			/^(\.github\/|docs\/)?pull_request_template\.md$|^\.github\/PULL_REQUEST_TEMPLATE\/|^\.gitlab\/merge_request_templates\//i,
		],
	],
	6: [
		[
			'ship loop (ship-pr script, ship-pr skill, .github/ship-pr.json)',
			/(^|\/)ship-pr(\.[cm]?[jt]s|\.json|\/SKILL\.md)$|^\.github\/ship-pr\.jsonc?$/i,
		],
	],
	7: [
		[
			'review bot config (.coderabbit.yaml, .cursor/BUGBOT.md, CODEOWNERS)',
			/^\.coderabbit\.ya?ml$|^\.cursor\/BUGBOT\.md$|(^|\/)\.?bugbot[^/]*$|(^|\/)CODEOWNERS$|^\.greptile|^\.sourcery/i,
		],
		[
			'deploy or preview config (vercel, netlify, fly, render, wrangler, Dockerfile, compose, k8s, terraform, *deploy*/*release* scripts)',
			/^(vercel\.json|netlify\.toml|render\.ya?ml|fly\.toml|wrangler\.(toml|jsonc?)|app\.ya?ml|railway\.(json|toml)|Procfile|serverless\.ya?ml|Dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml)$|(^|\/)(helm|k8s|kubernetes|terraform|deploy)\/|(^|\/)[^/]*(deploy|release|publish|nas-setup)[^/]*\.(sh|[cm]?[jt]s|ya?ml)$/i,
		],
	],
	8: [
		[
			'flags or rollback doc (*flags* module, *rollback*, *runbook*)',
			/(^|\/)[^/]*(feature-?flags?|flags)\.[cm]?[jt]sx?$|(^|\/)[^/]*(rollback|runbook)[^/]*$/i,
		],
	],
	9: [
		[
			'backup or restore files (*backup*, *restore*, litestream)',
			/(backup|restore|litestream)/i,
		],
	],
	10: [
		[
			'friction issue form (ISSUE_TEMPLATE/*friction*)',
			/^\.github\/ISSUE_TEMPLATE\/[^/]*friction[^/]*$|^\.gitlab\/issue_templates\/[^/]*friction/i,
		],
	],
	11: [
		[
			'label or triage config (labels.yml, triage workflow)',
			/^\.github\/labels\.ya?ml$|(^|\/)\.?labels\.(ya?ml|json)$|^\.github\/workflows\/[^/]*(triage|priorit)[^/]*\.ya?ml$/i,
		],
	],
	12: [
		[
			'cleanup issue form (ISSUE_TEMPLATE/*cleanup*)',
			/^\.github\/ISSUE_TEMPLATE\/[^/]*cleanup[^/]*$|^\.gitlab\/issue_templates\/[^/]*cleanup/i,
		],
	],
	13: [
		[
			'dependency or signal bot (dependabot, renovate, sentry config)',
			/^\.github\/dependabot\.ya?ml$|(^|\/)renovate\.json5?$|^\.sentryclirc$|(^|\/)sentry\.[^/]+\.[cm]?[jt]s$/i,
		],
		[
			'cleanup automation workflow (legacy reaper, friction sweep, docs freshness, test pruning, errors → issues)',
			/^\.github\/workflows\/[^/]*(cleanup|reaper|friction|docs-fresh|prune|pruning|tests-tight|errors?-to-issues)[^/]*\.ya?ml$/i,
		],
	],
}

// Doc keywords per rung: matches become hints (file:line), never evidence.
const docRules = {
	3: /\bprimitives?\b|building blocks/i,
	7: /\bpreview\b|\bstaging\b|\bdeploy/i,
	8: /feature[- ]flags?|\brollback\b|roll back/i,
	9: /\bbackups?\b|\brestore\b/i,
	11: /\bneeds-decision\b|\bP[0-3]\b.{0,40}\bpriorit|\bpriority (labels?|field)\b|\btriage\b/i,
	13: /\bcron\b|\bsentry\b|\balerts?\b|legacy[- ]reaper|friction[- ]sweep|docs?[- ]freshness|keep-tests-tight|test[- ]pruning|errors?(-to-| (→|->|to) )issues|codebase-cleanup/i,
}

const depLabels = {
	4: 'e2e dependency (playwright, cypress, puppeteer, webdriverio)',
	8: 'flag dependency (LaunchDarkly, Unleash, GrowthBook, OpenFeature, PostHog, ...)',
	13: 'error or telemetry dependency (Sentry, Bugsnag, Rollbar, OpenTelemetry, ...)',
}

const depRules = {
	4: /^(@playwright\/test|playwright|cypress|puppeteer|webdriverio)$/,
	8: /launchdarkly|unleash|flagsmith|growthbook|openfeature|statsig|posthog|configcat|@vercel\/flags|flipt|@splitsoftware/i,
	13: /^@sentry\/|^sentry-sdk$|bugsnag|rollbar|honeybadger|dd-trace|newrelic|@opentelemetry\//i,
}

const manifests = [
	['package.json', 'node'],
	['deno.json', 'deno'],
	['go.mod', 'go'],
	['Cargo.toml', 'rust'],
	['pyproject.toml', 'python'],
	['requirements.txt', 'python'],
	['Gemfile', 'ruby'],
	['composer.json', 'php'],
	['pom.xml', 'java'],
	['build.gradle', 'java/kotlin'],
	['build.gradle.kts', 'kotlin'],
	['mix.exs', 'elixir'],
	['Package.swift', 'swift'],
	['pubspec.yaml', 'dart/flutter'],
]

const lockfiles = [
	['pnpm-lock.yaml', 'pnpm'],
	['yarn.lock', 'yarn'],
	['bun.lockb', 'bun'],
	['bun.lock', 'bun'],
	['package-lock.json', 'npm'],
]

const verifyNames = ['validate', 'verify', 'ci', 'check:all', 'preflight']
const prSections = [
	'Intent',
	'Why',
	'Door',
	'Cleanup',
	'Testing',
	'System recap',
]

export function listFiles(root) {
	try {
		const out = execFileSync('git', ['ls-files', '-z'], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		const files = out.split('\0').filter(Boolean)
		if (files.length) return files.sort()
	} catch {}
	const files = []
	const walk = (dir, depth) => {
		if (depth > 6) return
		for (const entry of readdirSync(path.join(root, dir), {
			withFileTypes: true,
		})) {
			const rel = dir ? `${dir}/${entry.name}` : entry.name
			if (entry.isDirectory()) {
				if (!ignoredDirs.has(entry.name)) walk(rel, depth + 1)
			} else if (entry.isFile()) {
				files.push(rel)
			}
		}
	}
	walk('', 0)
	return files.sort()
}

function read(root, rel) {
	try {
		return readFileSync(path.join(root, rel), 'utf8')
	} catch {
		return ''
	}
}

// Pull shell commands out of CI YAML without a YAML parser: `run:` and
// `command:` values (inline, block, or folded plain scalars) and `script:` lists.
export function extractCiSteps(text) {
	const lines = text.split(/\r?\n/)
	const steps = []
	const indentOf = (line) => line.match(/^\s*/)[0].length
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^(\s*)(?:-\s+)?(run|command|script):\s*(.*)$/)
		if (!match) continue
		const keyIndent =
			indentOf(lines[i]) + (lines[i].trim().startsWith('-') ? 2 : 0)
		let value = match[3].trim()
		const body = []
		let j = i + 1
		while (
			j < lines.length &&
			(!lines[j].trim() || indentOf(lines[j]) > keyIndent)
		) {
			body.push(lines[j])
			j++
		}
		while (body.length && !body.at(-1).trim()) body.pop()
		if (match[2] === 'script' && (!value || value.startsWith('['))) {
			const items = value.startsWith('[')
				? value.replace(/^\[|\]$/g, '').split(',')
				: body.filter((line) => /^\s*-\s+/.test(line))
			for (const item of items) {
				const command = item
					.replace(/^\s*-\s+/, '')
					.trim()
					.replace(/^['"]|['"]$/g, '')
				if (command) steps.push(command)
			}
			i = j - 1
			continue
		}
		if (/^[|>][+-]?$/.test(value)) {
			value = body.map((line) => line.trim()).join('\n')
		} else if (body.length) {
			value = [value, ...body.map((line) => line.trim())]
				.filter(Boolean)
				.join(' ')
		} else if (/^(['"]).*\1$/.test(value)) {
			value = value.slice(1, -1)
		}
		value = value.trim()
		if (value) steps.push(value)
		i = j - 1
	}
	return steps
}

// Script names invoked by a command line: `npm run x`, `npm test`, `pnpm x`, `yarn x`, `bun run x`.
export function scriptCalls(command) {
	const calls = []
	const pattern =
		/(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+|--silent\s+run\s+)?([\w:.-]+)/g
	const builtins = new Set([
		'ci',
		'install',
		'i',
		'add',
		'exec',
		'dlx',
		'x',
		'publish',
		'audit',
		'outdated',
	])
	for (const match of command.matchAll(pattern)) {
		const viaRun = /\srun(?:-script)?\s/.test(match[0])
		const name = match[1] === 't' ? 'test' : match[1]
		if (!viaRun && builtins.has(name)) continue
		calls.push(name)
	}
	return calls
}

// Expand a package.json script into the leaf scripts it runs.
export function expandScript(scripts, name, seen = new Set()) {
	if (seen.has(name) || !(name in scripts)) return [name]
	seen.add(name)
	const calls = scriptCalls(scripts[name])
	if (!calls.length) return [name]
	const leaves = calls.flatMap((call) =>
		call in scripts ? expandScript(scripts, call, seen) : [call],
	)
	// A script that also runs its own tools (e.g. `tsc && npm run x`) is a leaf too.
	const own = scripts[name]
		.split(/&&|\|\||;/)
		.some((part) => part.trim() && !scriptCalls(part).length)
	return own ? [name, ...leaves] : leaves
}

// Repo-relative file paths mentioned in a text that do not exist.
export function missingReferences(root, rel, text, files) {
	const fileSet = new Set(files)
	const results = []
	const pattern =
		/(?<![\w@$/.{-])(?:\.\/)?((?:[\w-][\w.-]*\/)+[\w.-]+\.(?:m?[jt]sx?|c[jt]s|sh|py|rb|json|ya?ml|toml))(?![\w/])/g
	text.split(/\r?\n/).forEach((line, index) => {
		if (/^\s*#/.test(line) || /^\s*uses:/.test(line)) return
		for (const match of line.matchAll(pattern)) {
			const ref = match[1]
			if (/^(node_modules|https?|\.git)\//.test(ref) || ref.includes('${'))
				continue
			if (fileSet.has(ref) || existsSync(path.join(root, ref))) continue
			results.push({ file: rel, line: index + 1, ref })
		}
	})
	return results
}

// Local git history for a missing file: the commit that deleted it, if any.
export function deletedIn(root, ref) {
	try {
		const line = execFileSync(
			'git',
			['log', '-1', '--diff-filter=D', '--format=%h %as %s', '--', ref],
			{ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
		).trim()
		return line ? ` (deleted in ${line})` : ''
	} catch {
		return ''
	}
}

function gitInfo(root) {
	const run = (args) => {
		try {
			return execFileSync('git', args, {
				cwd: root,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			}).trim()
		} catch {
			return null
		}
	}
	const commit = run(['rev-parse', '--short', 'HEAD'])
	const status = run(['status', '--porcelain', '--untracked-files=no'])
	return { commit, dirty: status === null ? null : status.length > 0 }
}

export function runVerify(root, command, timeoutSec = 900) {
	const started = Date.now()
	const result = spawnSync(command, {
		cwd: root,
		shell: true,
		encoding: 'utf8',
		timeout: timeoutSec * 1000,
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, CI: process.env.CI ?? '1' },
	})
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
		.replace(/\x1b\[[0-9;]*m/g, '')
		.trimEnd()
	return {
		command,
		exitCode: result.status ?? null,
		durationMs: Date.now() - started,
		...(result.error ? { error: result.error.message } : {}),
		tail: output.split(/\r?\n/).slice(-15).join('\n'),
	}
}

export function detect(root, { verify = [], timeout = 900 } = {}) {
	root = path.resolve(root)
	const files = listFiles(root)
	const evidence = Object.fromEntries(rungs.map((rung) => [rung.id, new Set()]))
	const checked = Object.fromEntries(rungs.map((rung) => [rung.id, []]))
	const hints = Object.fromEntries(rungs.map((rung) => [rung.id, []]))
	const findings = []

	for (const [id, rules] of Object.entries(pathRules)) {
		for (const [label, pattern] of rules) {
			checked[id].push(label)
			for (const file of files) if (pattern.test(file)) evidence[id].add(file)
		}
	}

	// Stack
	const stackParts = []
	const manifestFiles = []
	const pkg = (() => {
		try {
			return JSON.parse(read(root, 'package.json') || 'null')
		} catch {
			return null
		}
	})()
	for (const [file, ecosystem] of manifests) {
		if (files.includes(file)) {
			manifestFiles.push(file)
			if (!stackParts.includes(ecosystem) && file !== 'package.json')
				stackParts.push(ecosystem)
		}
	}
	const lock = lockfiles.find(([file]) => files.includes(file))
	if (lock) manifestFiles.push(lock[0])
	const pm = lock?.[1] ?? 'npm'
	const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {}
	if (pkg) {
		const notable = Object.keys(deps).filter((dep) =>
			/^(react|next|remix|@remix-run\/[\w-]+|react-router|vue|nuxt|svelte|@sveltejs\/kit|astro|solid-js|express|fastify|hono|koa|@nestjs\/core|electron|react-native|expo|typescript|vitest|jest|mocha|@playwright\/test|cypress)$/.test(
				dep,
			),
		)
		stackParts.unshift(
			[
				`node (${pm})`,
				pkg.engines?.node && `engines.node ${pkg.engines.node}`,
				notable.join(', '),
			]
				.filter(Boolean)
				.join(' · '),
		)
	}
	for (const file of [
		'Dockerfile',
		'.nvmrc',
		'.node-version',
		'.tool-versions',
		'tsconfig.json',
	]) {
		if (files.includes(file)) manifestFiles.push(file)
	}

	// Dependencies that count as evidence
	for (const [id, pattern] of Object.entries(depRules)) {
		checked[id].push(depLabels[id])
		for (const dep of Object.keys(deps)) {
			if (pattern.test(dep))
				evidence[id].add(`package.json#dependencies.${dep}`)
		}
	}

	// CI steps and schedules
	const ciFiles = [...evidence[1]].filter((file) =>
		pathRules[1][1][1].test(file),
	)
	const ciSteps = []
	for (const file of ciFiles) {
		const text = read(root, file)
		const healthLines = []
		for (const run of extractCiSteps(text)) ciSteps.push({ file, run })
		text.split(/\r?\n/).forEach((line, index) => {
			const cron = line.match(/cron:\s*['"]?([^'"#]+)/)
			if (cron) {
				evidence[13].add(file)
				hints[13].push(`${file}:${index + 1} schedule "${cron[1].trim()}"`)
			}
			if (/\bpreview\b/i.test(line))
				hints[7].push(`${file}:${index + 1} mentions preview`)
			if (
				/\b(deploy|publish|release)\b/i.test(line) &&
				/^\s*(name|run|uses):/.test(line)
			) {
				evidence[7].add(file)
			}
			if (/\/health\b|healthz|health check/i.test(line)) {
				healthLines.push(index + 1)
			}
		})
		if (healthLines.length) {
			hints[4].push(
				`${file}:${healthLines.join(',')} health check (not a feature test)`,
			)
		}
		for (const missing of missingReferences(root, file, text, files)) {
			findings.push({
				text: `${missing.file}:${missing.line} references ${missing.ref}, which does not exist${deletedIn(root, missing.ref)}`,
				file: missing.file,
				rung: /deploy|release|publish/i.test(file) ? 7 : 1,
			})
		}
	}
	for (const file of files.filter((f) => /(^|\/)Dockerfile$/.test(f))) {
		for (const missing of missingReferences(
			root,
			file,
			read(root, file),
			files,
		)) {
			findings.push({
				text: `${missing.file}:${missing.line} references ${missing.ref}, which does not exist${deletedIn(root, missing.ref)}`,
				file,
				rung: 7,
			})
		}
	}

	// Verify command vs CI
	const scripts = pkg?.scripts ?? {}
	const run = (name) => (pm === 'npm' ? `npm run ${name}` : `${pm} run ${name}`)
	const candidates = Object.keys(scripts)
		.filter((name) =>
			/^(validate|verify|ci|check|test|lint|typecheck|type-check|format|build|e2e)(:.*)?$/.test(
				name,
			),
		)
		.map((name) => ({
			command: run(name),
			source: `package.json#scripts.${name}`,
			definition: scripts[name],
		}))
	for (const target of ['verify', 'validate', 'check', 'ci', 'test', 'lint']) {
		if (
			files.includes('Makefile') &&
			new RegExp(`^${target}:`, 'm').test(read(root, 'Makefile'))
		) {
			candidates.push({
				command: `make ${target}`,
				source: 'Makefile',
				definition: '',
			})
		}
		const just = files.find((f) => /^justfile$/i.test(f))
		if (just && new RegExp(`^${target}\\b.*:`, 'm').test(read(root, just))) {
			candidates.push({
				command: `just ${target}`,
				source: just,
				definition: '',
			})
		}
	}
	const primaryName = verifyNames.find((name) => name in scripts)
	const primary = primaryName
		? run(primaryName)
		: (candidates.find((c) =>
				/^(make|just) (verify|validate|check|ci)$/.test(c.command),
			)?.command ?? null)
	if (primaryName) evidence[1].add(`package.json#scripts.${primaryName}`)
	const ciScripts = new Set(
		ciSteps.flatMap(({ run: command }) =>
			scriptCalls(command).flatMap((name) => expandScript(scripts, name)),
		),
	)
	const steps = primaryName ? expandScript(scripts, primaryName) : []
	const notInCi = steps.filter((name) => !ciScripts.has(name))
	if (
		primaryName &&
		ciFiles.length &&
		!ciScripts.has(primaryName) &&
		notInCi.length
	) {
		findings.push({
			text: `CI does not run \`${run(primaryName)}\`; it skips ${notInCi.map((name) => `\`${name}\` (${scripts[name] ?? '?'})`).join(', ')}`,
			rung: 1,
		})
	}
	const controlBins = Object.keys(
		typeof pkg?.bin === 'object' && pkg.bin ? pkg.bin : {},
	).filter((name) => controlScriptPattern.test(name))
	for (const name of controlBins) evidence[4].add(`package.json#bin.${name}`)
	for (const name of Object.keys(scripts)) {
		if (controlScriptPattern.test(name))
			evidence[4].add(`package.json#scripts.${name}`)
	}
	checked[4].push('control CLI package script or bin (control-*)')
	const items4 = [...evidence[4]]
	const hasControlCli = items4.some(
		(item) =>
			controlCliPathPattern.test(item) ||
			/^package\.json#(scripts|bin)\.control/i.test(item),
	)
	const hasControlSkill = items4.some((item) =>
		controlSkillPathPattern.test(item),
	)
	const hasFeatureMap = items4.some((item) => featureMapPathPattern.test(item))
	const guide = '(references/verification.md)'
	if (!hasControlCli && !hasControlSkill) {
		findings.push({
			text: `No project control CLI or skill found (tools/control-*.ts, bin/control-*, .agents/skills/control-*/SKILL.md). Plan a rung 4 PR to build one that verifies locally: doctor, dev, login, request --contains, execute, browse --record, map --check, health --sha; preview --pr only for production-like checks ${guide}.`,
			rung: 4,
		})
	} else if (!hasControlCli) {
		findings.push({
			text: `Control skill found but no project control CLI (tools/control-*.ts, bin/control-*, control-* package script). Plan a rung 4 PR to build the CLI ${guide}.`,
			rung: 4,
		})
	} else if (!hasControlSkill) {
		findings.push({
			text: `Control CLI found but no control-<project> skill (.agents/skills/control-*/SKILL.md). Plan a rung 4 PR to add it ${guide}.`,
			rung: 4,
		})
	}
	if (!hasFeatureMap) {
		findings.push({
			text: `No Feature Map found (feature-catalog.*, feature-map.*, skills/control-*/references/features/). For an app with routes, plan a rung 4 PR to generate one from the framework's route list, with seed-and-reach notes per page and \`map --check\` in CI; projects without routes skip it ${guide}.`,
			rung: 4,
		})
	}
	const e2eScripts = Object.keys(scripts).filter((name) =>
		/e2e|playwright|cypress|smoke/i.test(name),
	)
	for (const name of e2eScripts) {
		evidence[4].add(`package.json#scripts.${name}`)
		if (!ciScripts.has(name) && !steps.includes(name)) {
			hints[4].push(
				`script \`${name}\` runs in neither CI nor the verify command`,
			)
		}
	}

	// Agent docs and docs: keyword hints
	const docs = files.filter(
		(file) =>
			/\.mdx?$/i.test(file) &&
			file.split('/').length <= 3 &&
			!/^\.agents\/skills\/(?!ship-pr)/.test(file),
	)
	for (const file of docs) {
		const text = read(root, file)
		if (text.length > 500_000) continue
		text.split(/\r?\n/).forEach((line, index) => {
			for (const [id, pattern] of Object.entries(docRules)) {
				if (pattern.test(line) && hints[id].length < 8) {
					hints[id].push(`${file}:${index + 1} ${line.trim().slice(0, 100)}`)
				}
			}
		})
	}
	for (const file of [...evidence[1]].filter((f) => /\.md$/i.test(f))) {
		const lineCount = read(root, file).split(/\r?\n/).length
		hints[1].push(`${file} is ${lineCount} lines`)
	}

	// PR template sections and Cleanup field
	for (const file of evidence[5]) {
		const text = read(root, file)
		const has = prSections.filter((section) =>
			new RegExp(`(^#+\\s*${section}\\b|^${section}:)`, 'im').test(text),
		)
		const lacks = prSections.filter((section) => !has.includes(section))
		hints[5].push(
			`${file} has [${has.join(', ')}], lacks [${lacks.join(', ')}]`,
		)
		if (has.includes('Cleanup')) {
			evidence[12].add(file)
		} else {
			hints[12].push(`${file} has no Cleanup field`)
		}
	}
	checked[12].push('PR template Cleanup field')
	checked[13].push('CI schedules (cron:)')

	// Ship loop: deterministic script or config present?
	const shipScript = [...evidence[6]].some((f) =>
		/ship-pr\.[cm]?[jt]s$|ship-pr\.jsonc?$/.test(f),
	)
	for (const file of [...evidence[6]].filter((f) => f.endsWith('SKILL.md'))) {
		const text = read(root, file)
		const deterministic =
			/ship-pr\.mjs|kcd-skills\S* autopilot ship-pr|\btick\b|@kentcdodds\/ship-pr/.test(
				text,
			)
		hints[6].push(
			`${file} ${deterministic ? 'calls a deterministic tick/script' : 'is a prose loop (no ship-pr script or tick)'}`,
		)
	}
	if (!shipScript) hints[6].push('no ship-pr script or .github/ship-pr.json')
	const issueTemplates = files.filter((f) =>
		/^\.github\/ISSUE_TEMPLATE\/|^\.gitlab\/issue_templates\//.test(f),
	)
	hints[10].push(
		issueTemplates.length
			? `issue templates: ${issueTemplates.join(', ')}`
			: 'no issue templates',
	)
	hints[11].push(
		'the priority scheme and decision marker live in the tracker: record them with kcd-skills autopilot triage',
	)
	hints[12].push(
		'labels and open Cleanup issues live in the tracker: check there or mark inferred',
	)
	hints[10].push(
		'friction labels live in the tracker: check there or mark inferred',
	)

	return {
		schemaVersion: 1,
		repo: { name: path.basename(root), path: root, ...gitInfo(root) },
		generatedAt: new Date().toISOString(),
		stack: { summary: stackParts.join('; '), evidence: manifestFiles },
		ci: { files: ciFiles, steps: ciSteps },
		verify: {
			primary,
			steps: steps.map((name) => ({
				script: name,
				definition: scripts[name] ?? null,
				inCi: ciScripts.has(name),
			})),
			candidates,
			results: verify.map((command) => runVerify(root, command, timeout)),
		},
		findings,
		rungs: rungs.map((rung) => ({
			...rung,
			score: null,
			evidence: [...evidence[rung.id]].sort(),
			checked: checked[rung.id],
			hints: [...new Set(hints[rung.id])],
			notes: '',
		})),
	}
}

// Keep agent-judged fields from a previous run of the same file.
// Audits written before rung 11 (Triage) existed have 12 rungs, with Cleanup
// issues at 11 and cleanup cron agents at 12. Shift those to 12 and 13.
export function migrateRungIds(audit) {
	const cleanup = audit?.rungs?.find((r) => r?.id === 11)
	if (
		!Array.isArray(audit?.rungs) ||
		audit.rungs.length !== 12 ||
		!/^cleanup issues$/i.test(cleanup?.name ?? '')
	) {
		return audit
	}
	const shift = (id) => (id === 11 || id === 12 ? id + 1 : id)
	const shiftRows = (rows) =>
		Array.isArray(rows)
			? rows.map((row) =>
					row && typeof row.rung === 'number'
						? { ...row, rung: shift(row.rung) }
						: row,
				)
			: rows
	return {
		...audit,
		rungs: audit.rungs.map((rung) => ({ ...rung, id: shift(rung.id) })),
		...(audit.plan ? { plan: shiftRows(audit.plan) } : {}),
		...(audit.prs ? { prs: shiftRows(audit.prs) } : {}),
		...(audit.findings ? { findings: shiftRows(audit.findings) } : {}),
		...(audit.host?.facts
			? { host: { ...audit.host, facts: shiftRows(audit.host.facts) } }
			: {}),
	}
}

export function mergePrevious(next, previous) {
	previous = migrateRungIds(previous)
	if (!previous?.rungs) return next
	const keepRows = (key) => (previous[key] ? { [key]: previous[key] } : {})
	return {
		...next,
		...keepRows('plan'),
		...keepRows('prs'),
		...keepRows('interview'),
		...keepRows('host'),
		...keepRows('triage'),
		stack: {
			...next.stack,
			summary: previous.stack?.summary || next.stack.summary,
		},
		verify: {
			...next.verify,
			// Merge by command: a re-run replaces only that command's result.
			results: [
				...(previous.verify?.results ?? []).filter(
					(old) => !next.verify.results.some((r) => r.command === old.command),
				),
				...next.verify.results,
			],
		},
		findings: [
			...next.findings,
			...(previous.findings ?? []).filter(
				(f) => !next.findings.some((n) => n.text === f.text),
			),
		],
		rungs: next.rungs.map((rung) => {
			const old = previous.rungs.find((r) => r.id === rung.id)
			if (!old) return rung
			return {
				...rung,
				score: old.score ?? null,
				notes: old.notes ?? '',
				...(old.inferred !== undefined ? { inferred: old.inferred } : {}),
				evidence: [
					...new Set([...rung.evidence, ...(old.evidence ?? [])]),
				].sort(),
				checked: [...new Set([...rung.checked, ...(old.checked ?? [])])],
			}
		}),
	}
}

function summarize(result) {
	const lines = [
		`Repo: ${result.repo.name} @ ${result.repo.commit ?? 'no git'}${result.repo.dirty ? ' (dirty)' : ''}`,
		`Stack: ${result.stack.summary || 'unknown'} [${result.stack.evidence.join(', ')}]`,
		`CI: ${result.ci.files.join(', ') || 'none found'}`,
		...result.ci.steps.map((step) => {
			const flat = step.run.replace(/\s*\n\s*/g, ' ⏎ ')
			return `  ${step.file}: ${flat.length > 120 ? `${flat.slice(0, 117)}...` : flat}`
		}),
		`Verify primary: ${result.verify.primary ?? 'none found'}`,
		...result.verify.steps.map(
			(s) =>
				`  ${s.script}: ${s.definition ?? '?'}${s.inCi ? '' : '  (not in CI)'}`,
		),
		`Verify candidates: ${result.verify.candidates.map((c) => c.command).join(', ') || 'none'}`,
		...result.verify.results.map(
			(r) =>
				`Ran: ${r.command} → exit ${r.exitCode} (${(r.durationMs / 1000).toFixed(1)}s)`,
		),
		'Findings:',
		...(result.findings.length
			? result.findings.map((f) => `  - ${f.text}`)
			: ['  none']),
		'Rungs (evidence | hints):',
	]
	for (const rung of result.rungs) {
		lines.push(
			`  ${rung.id}. [${rung.pillar}] ${rung.name}: ${rung.evidence.join(', ') || 'no evidence'}`,
		)
		for (const hint of rung.hints) lines.push(`       ${hint}`)
	}
	return lines.join('\n')
}

export const fieldGuide = `Fill each rung (by hand or with kcd-skills autopilot score), then run kcd-skills autopilot report:
  score     done | partial (exists, misses part) | missing | unknown (nothing you can read shows it); n/a only in the plan step
  evidence  paths or read-only commands that support the score (keep or add)
  checked   what you looked for and did not find
  notes     why; required for partial, unknown, n/a, and inferred
  inferred  true when only the human can confirm it
Add judgment findings with kcd-skills autopilot finding. Re-running with --out keeps these fields.
Host facts (reviewers, merges, branch rules, labels, issues): kcd-skills autopilot host request prints what to gather and the format.`

const usage = `Usage: kcd-skills autopilot audit [repo-dir] [--out audit.json] [--verify "<command>"]... [--timeout seconds]
Prefills audit JSON; leaves score and notes for the agent. --verify runs a command in the repo and records the result.`

export function parseArgs(args) {
	const options = { root: '.', out: null, verify: [], timeout: 900 }
	let rootSet = false
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--help' || arg === '-h') return { help: true }
		if (arg === '--out' || arg === '--verify' || arg === '--timeout') {
			const value = args[++i]
			if (!value) throw new Error(`${arg} requires a value`)
			if (arg === '--out') options.out = value
			if (arg === '--verify') options.verify.push(value)
			if (arg === '--timeout') {
				options.timeout = Number(value)
				if (!Number.isInteger(options.timeout) || options.timeout < 1) {
					throw new Error('--timeout must be a positive integer')
				}
			}
		} else if (arg.startsWith('--')) {
			throw new Error(`Unknown option: ${arg}`)
		} else if (!rootSet) {
			options.root = arg
			rootSet = true
		} else {
			throw new Error(`Unexpected argument: ${arg}`)
		}
	}
	return options
}

export function main(args = process.argv.slice(2)) {
	const options = parseArgs(args)
	if (options.help) {
		console.log(usage)
		return 0
	}
	if (!existsSync(options.root))
		throw new Error(`No such directory: ${options.root}`)
	let result = detect(options.root, options)
	if (options.out && existsSync(options.out)) {
		result = mergePrevious(
			result,
			JSON.parse(readFileSync(options.out, 'utf8')),
		)
	}
	console.log(summarize(result))
	if (options.out) {
		writeFileSync(options.out, `${JSON.stringify(result, null, '\t')}\n`)
		console.log(`Wrote ${options.out}. ${fieldGuide}`)
	} else {
		console.log(JSON.stringify(result, null, '\t'))
	}
	return result.verify.results.some((r) => r.exitCode !== 0) ? 2 : 0
}

// Compare real paths so a symlinked temp dir (macOS /var -> /private/var)
// still runs the script.
function isMain() {
	if (!process.argv[1]) return false
	try {
		return (
			realpathSync(fileURLToPath(import.meta.url)) ===
			realpathSync(process.argv[1])
		)
	} catch {
		return false
	}
}

if (isMain()) {
	try {
		process.exitCode = main()
	} catch (error) {
		console.error(error.message)
		process.exitCode = 1
	}
}
