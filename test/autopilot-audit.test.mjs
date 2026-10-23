import assert from 'node:assert/strict'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
	dedupeFindings,
	detect,
	expandScript,
	extractCiSteps,
	formatCarryOver,
	formatVerifyLine,
	main as auditMain,
	mergePrevious,
	migrateRungIds,
	rungs as detectRungs,
	sameRepo,
	scriptCalls,
	usage as auditUsage,
} from '../skills/autopilot/scripts/audit-detect.mjs'
import {
	main,
	planTable,
	renderHtml,
	renderText,
	rungs as reportRungs,
	validate,
	validateTriage,
} from '../skills/autopilot/scripts/audit-report.mjs'

function validAudit(overrides = {}) {
	const scoreFor = { 1: 'partial', 2: 'missing', 5: 'done', 9: 'unknown' }
	return {
		schemaVersion: 1,
		repo: { name: 'app', commit: 'abc1234' },
		stack: { summary: 'node (npm) · vitest', evidence: ['package.json'] },
		verify: { results: [{ command: 'npm run validate', exitCode: 0 }] },
		findings: [{ text: 'CI skips `format:check`', rung: 1 }],
		rungs: reportRungs.map(({ id, pillar, name }) => {
			const score = scoreFor[id] ?? 'n/a'
			return {
				id,
				pillar,
				name,
				score,
				evidence: ['done', 'partial'].includes(score) ? ['AGENTS.md'] : [],
				checked: ['docs/decisions/'],
				notes: score === 'missing' || score === 'done' ? '' : `why ${id}`,
			}
		}),
		...overrides,
	}
}

function withRung(id, changes) {
	const audit = validAudit()
	audit.rungs = audit.rungs.map((rung) =>
		rung.id === id ? { ...rung, ...changes } : rung,
	)
	return audit
}

const plan = [
	{
		rung: 1,
		title: 'Run validate in CI',
		files: ['.github/workflows/ci.yml'],
		effort: 'S',
		door: 'two-way',
	},
	{
		rung: 2,
		title: 'Seed decisions',
		files: ['docs/decisions/README.md'],
		effort: 'S',
		door: 'two-way',
	},
]

test('detect and report scripts share the same 13 rungs and pillars', () => {
	assert.equal(reportRungs.length, 13)
	assert.deepEqual(
		detectRungs,
		reportRungs.map(({ id, pillar, name }) => ({ id, pillar, name })),
	)
})

function tempRepo(t, files) {
	const root = mkdtempSync(path.join(tmpdir(), 'autopilot-detect-'))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	for (const [file, text] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
		writeFileSync(path.join(root, file), text)
	}
	return root
}

const controlFinding = (result) =>
	result.findings.find(
		(f) => f.rung === 4 && /No project control CLI or skill/.test(f.text),
	)

test('detect recognizes a rung 4 control CLI and its skill', (t) => {
	const root = tempRepo(t, {
		'package.json': JSON.stringify({
			scripts: { 'control-app': 'node tools/control-app.ts' },
		}),
		'tools/control-app.ts': 'export {}\n',
		'tools/control-app/feature-catalog.ts': 'export {}\n',
		'.agents/skills/control-app/SKILL.md': '# control-app\n',
		'.agents/skills/control-app/references/features/README.md': '# Map\n',
	})
	const result = detect(root)
	const rung4 = result.rungs.find((r) => r.id === 4)
	assert.equal(rung4.name, 'Self-verification: control CLI + skill')
	assert.ok(rung4.evidence.includes('tools/control-app.ts'))
	assert.ok(rung4.evidence.includes('.agents/skills/control-app/SKILL.md'))
	assert.ok(rung4.evidence.includes('package.json#scripts.control-app'))
	assert.ok(rung4.evidence.includes('tools/control-app/feature-catalog.ts'))
	assert.deepEqual(
		result.findings.filter((f) => f.rung === 4),
		[],
	)
	for (const label of [
		/^project control CLI/,
		/^control skill/,
		/^Feature Map/,
	])
		assert.ok(rung4.checked.some((c) => label.test(c)))
	assert.equal(controlFinding(result), undefined)
	const report = reportRungs.find((r) => r.id === 4)
	assert.equal(report.name, rung4.name)
})

test('detect counts a control bin entry as rung 4 evidence', (t) => {
	const root = tempRepo(t, {
		'package.json': JSON.stringify({ bin: { 'control-cli': './cli.js' } }),
	})
	const result = detect(root)
	const rung4 = result.rungs.find((r) => r.id === 4)
	assert.ok(rung4.evidence.includes('package.json#bin.control-cli'))
	assert.equal(controlFinding(result), undefined)
})

test('detect checks the control CLI, skill, and Feature Map separately', (t) => {
	const root = tempRepo(t, {
		'package.json': JSON.stringify({
			scripts: { control: 'node tools/control-app.ts' },
		}),
		'tools/control-app.ts': 'export {}\n',
	})
	const texts = detect(root)
		.findings.filter((f) => f.rung === 4)
		.map((f) => f.text)
	assert.equal(texts.length, 2)
	assert.match(texts[0], /Control CLI found but no control-<project> skill/)
	assert.match(texts[1], /No Feature Map found.*map --check/)
	const lookalikes = detect(
		tempRepo(t, {
			'tools/control-app.ts': 'export {}\n',
			'.agents/skills/control-app/SKILL.md': '# control-app\n',
			'app/components/FeatureMap.tsx': 'export {}\n',
			'app/feature-mapping.ts': 'export {}\n',
		}),
	)
	assert.ok(
		lookalikes.findings.some(
			(f) => f.rung === 4 && /No Feature Map found/.test(f.text),
		),
	)
	const mapJson = detect(
		tempRepo(t, {
			'tools/control-app.ts': 'export {}\n',
			'.agents/skills/control-app/SKILL.md': '# control-app\n',
			'docs/feature-map.json': '{}\n',
		}),
	)
	assert.deepEqual(
		mapJson.findings.filter((f) => f.rung === 4),
		[],
	)
	const skillOnly = detect(
		tempRepo(t, { '.agents/skills/control-app/SKILL.md': '# control-app\n' }),
	).findings.filter((f) => f.rung === 4)
	assert.ok(
		skillOnly.some((f) =>
			/Control skill found but no project control CLI/.test(f.text),
		),
	)
})

test('detect proposes a control CLI when rung 4 has none', (t) => {
	const root = tempRepo(t, {
		'package.json': JSON.stringify({
			scripts: { 'test:e2e': 'playwright test' },
		}),
		'playwright.config.ts': 'export default {}\n',
	})
	const result = detect(root)
	const finding = controlFinding(result)
	assert.ok(finding)
	assert.match(finding.text, /Include rung 4 in the setup PR: build one/)
	assert.match(
		finding.text,
		/dev.*request --contains.*browse --record.*health --sha.*preview --pr only for production-like/,
	)
	assert.match(finding.text, /references\/verification\.md/)
	const rung4 = result.rungs.find((r) => r.id === 4)
	assert.ok(rung4.evidence.includes('playwright.config.ts'))
})

test('detect recognizes rung 13 cleanup automations', (t) => {
	const root = mkdtempSync(path.join(tmpdir(), 'autopilot-detect-'))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const write = (file, text) => {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
		writeFileSync(path.join(root, file), text)
	}
	write(
		'.github/workflows/legacy-reaper.yml',
		"on:\n  schedule:\n    - cron: '0 8 * * 1'\njobs: {}\n",
	)
	write('.github/workflows/docs-freshness.yml', 'on: workflow_dispatch\n')
	write(
		'AGENTS.md',
		'# Map\n\nCleanup agents: forked codebase-cleanup (legacy reaper, keep-tests-tight).\n',
	)
	const rung13 = detect(root).rungs.find((r) => r.id === 13)
	assert.equal(rung13.name, 'Signals + cleanup cron agents')
	assert.ok(rung13.evidence.includes('.github/workflows/legacy-reaper.yml'))
	assert.ok(rung13.evidence.includes('.github/workflows/docs-freshness.yml'))
	assert.ok(rung13.checked.some((c) => /cleanup automation workflow/.test(c)))
	assert.ok(
		rung13.hints.some((h) => /^AGENTS\.md:3 .*codebase-cleanup/.test(h)),
	)
	assert.ok(
		rung13.hints.some((h) =>
			/legacy-reaper\.yml:3 schedule "0 8 \* \* 1"/.test(h),
		),
	)
	write('docs/ops.md', 'Our errors-to-issues agent files bugs.\n')
	assert.ok(
		detect(root)
			.rungs.find((r) => r.id === 13)
			.hints.some((h) => /^docs\/ops\.md:1 /.test(h)),
	)
	const report = reportRungs.find((r) => r.id === 13)
	assert.equal(report.name, rung13.name)
	assert.deepEqual(report.needs, [10, 11, 12])
})

test('rung 11 triage sits between friction and cleanup issues', (t) => {
	const root = mkdtempSync(path.join(tmpdir(), 'autopilot-detect-'))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	mkdirSync(path.join(root, '.github'), { recursive: true })
	writeFileSync(path.join(root, '.github/labels.yml'), '- name: P0\n')
	writeFileSync(
		path.join(root, 'CONTRIBUTING.md'),
		'Triage: add a P1 priority label, or needs-decision.\n',
	)
	const rungs = detect(root).rungs
	assert.deepEqual(
		rungs.filter((r) => r.pillar === 'improve').map((r) => [r.id, r.name]),
		[
			[10, 'Friction form'],
			[11, 'Triage: priority + decision marker'],
			[12, 'Cleanup issues'],
			[13, 'Signals + cleanup cron agents'],
		],
	)
	const triage = rungs.find((r) => r.id === 11)
	assert.ok(triage.evidence.includes('.github/labels.yml'))
	assert.ok(triage.hints.some((h) => /^CONTRIBUTING\.md:1 /.test(h)))
	assert.ok(triage.hints.some((h) => /kcd-skills autopilot triage/.test(h)))
	assert.deepEqual(
		reportRungs.filter((r) => r.id >= 11).map((r) => [r.id, r.needs]),
		[
			[11, [10]],
			[12, [5, 11]],
			[13, [10, 11, 12]],
		],
	)
})

test('extractCiSteps reads inline, block, folded, and script-list commands', () => {
	const steps = extractCiSteps(`jobs:
  test:
    steps:
      - run: npm ci
      - name: Many
        run: |
          npm run lint
          npm test
      - name: Folded
        run:
          node --import ./server/hooks.mjs ./scripts/release.ts \${{
          inputs.type }}
      - run: "echo quoted"
lint:
  script:
    - make lint
    - make test
`)
	assert.deepEqual(steps, [
		'npm ci',
		'npm run lint\nnpm test',
		'node --import ./server/hooks.mjs ./scripts/release.ts ${{ inputs.type }}',
		'echo quoted',
		'make lint',
		'make test',
	])
})

test('scriptCalls and expandScript resolve package script chains', () => {
	assert.deepEqual(scriptCalls('npm ci && npm run lint && npm test'), [
		'lint',
		'test',
	])
	assert.deepEqual(scriptCalls('pnpm typecheck; yarn run build'), [
		'typecheck',
		'build',
	])
	const scripts = {
		validate: 'npm run check && npm run test',
		check: 'npm run format:check && npm run lint',
		'format:check': 'prettier --check .',
		lint: 'eslint .',
		test: 'vitest run',
	}
	assert.deepEqual(expandScript(scripts, 'validate'), [
		'format:check',
		'lint',
		'test',
	])
	assert.deepEqual(expandScript({ a: 'npm run a' }, 'a'), ['a'])
})

test('detect prefills evidence and deterministic findings without scoring', (t) => {
	const root = mkdtempSync(path.join(tmpdir(), 'autopilot-detect-'))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const write = (file, text) => {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
		writeFileSync(path.join(root, file), text)
	}
	write(
		'package.json',
		JSON.stringify({
			scripts: {
				validate: 'npm run format:check && npm run lint',
				'format:check': 'prettier --check .',
				lint: 'eslint .',
				'test:e2e': 'playwright test',
			},
			devDependencies: { '@sentry/node': '1.0.0' },
		}),
	)
	write('package-lock.json', '{}')
	write('AGENTS.md', '# Map\n\nRun `npm run validate`.\n')
	write('docs/decisions/0001-no-orm.md', '# 0001: No ORM\n')
	write(
		'.github/pull_request_template.md',
		'## Intent\n\nCleanup: none\n\n## Testing\n',
	)
	write(
		'.github/workflows/ci.yml',
		`on:
  schedule:
    - cron: '0 6 * * *'
jobs:
  lint:
    steps:
      - run: npm ci
      - run: npm run lint
      - run: node ./scripts/missing.mjs
`,
	)
	write('README.md', '## Backups\n\nCopy the database file to restore.\n')
	const result = detect(root)
	const rung = (id) => result.rungs.find((r) => r.id === id)
	assert.equal(result.verify.primary, 'npm run validate')
	assert.deepEqual(
		result.verify.steps.map((s) => [s.script, s.inCi]),
		[
			['format:check', false],
			['lint', true],
		],
	)
	assert.ok(
		result.findings.some((f) =>
			/scripts\/missing\.mjs, which does not exist/.test(f.text),
		),
	)
	assert.ok(
		result.findings.some(
			(f) => f.rung === 1 && /skips `format:check`/.test(f.text),
		),
	)
	assert.ok(rung(1).evidence.includes('AGENTS.md'))
	assert.ok(rung(1).evidence.includes('package.json#scripts.validate'))
	assert.deepEqual(rung(2).evidence, ['docs/decisions/0001-no-orm.md'])
	assert.ok(rung(4).hints.some((h) => /test:e2e/.test(h)))
	assert.ok(
		rung(5).hints.some((h) => /lacks \[Why, Door, System recap\]/.test(h)),
	)
	assert.ok(rung(12).evidence.includes('.github/pull_request_template.md'))
	assert.ok(rung(9).hints.some((h) => h.startsWith('README.md:1')))
	assert.ok(rung(13).evidence.includes('.github/workflows/ci.yml'))
	assert.ok(
		rung(13).evidence.includes('package.json#dependencies.@sentry/node'),
	)
	assert.ok(result.rungs.every((r) => r.score === null && r.notes === ''))
	assert.match(result.stack.summary, /node \(npm\)/)
	// The skeleton is not a valid audit until the agent scores it.
	assert.ok(
		validate(result).some((e) => /rung 1\.score must be one of/.test(e)),
	)
})

test('mergePrevious keeps judged fields when the detector re-runs', () => {
	const previous = validAudit({ plan })
	const next = {
		...validAudit(),
		verify: { results: [] },
		rungs: validAudit().rungs.map((r) => ({
			...r,
			score: null,
			notes: '',
			evidence: [],
		})),
	}
	const { result: merged, carry } = mergePrevious(next, previous)
	assert.equal(merged.rungs[0].score, 'partial')
	assert.equal(merged.rungs[0].notes, 'why 1')
	assert.deepEqual(merged.rungs[0].evidence, ['AGENTS.md'])
	assert.equal(merged.verify.results.length, 1)
	assert.equal(merged.verify.results[0].command, 'npm run validate')
	assert.equal(merged.verify.results[0].carriedOver, true)
	assert.deepEqual(merged.plan, plan)
	assert.deepEqual(carry.verifyNotRerun, ['npm run validate'])
	assert.match(formatCarryOver(carry), /Verify commands not re-run/)
})

test('mergePrevious refuses a file from a different repo', () => {
	const previous = validAudit({
		repo: { name: 'other', path: '/tmp/other-repo' },
		verify: {
			results: [{ command: 'npm run validate', exitCode: 1, note: 'stale' }],
		},
	})
	const next = {
		...validAudit(),
		repo: { name: 'app', path: '/tmp/app' },
		verify: { results: [] },
		findings: [],
		rungs: validAudit().rungs.map((r) => ({
			...r,
			score: null,
			notes: '',
			evidence: [],
		})),
	}
	const { result, carry, skipped } = mergePrevious(next, previous)
	assert.equal(carry, null)
	assert.equal(skipped.reason, 'different-repo')
	assert.equal(result.verify.results.length, 0)
	assert.equal(result.rungs[0].score, null)
	assert.equal(sameRepo(next, previous), false)
	assert.equal(
		sameRepo(
			{ repo: { name: 'app', path: '/tmp/app' } },
			{ repo: { name: 'app', path: '/tmp/app' } },
		),
		true,
	)
})

test('dedupeFindings collapses missing-path duplicates by file and ref', () => {
	const findings = [
		{
			text: 'ci.yml:3 references server/register-hooks.mjs, which does not exist',
			file: 'ci.yml',
			ref: 'server/register-hooks.mjs',
			rung: 1,
		},
		{
			text: 'ci.yml:9 references server/register-hooks.mjs, which does not exist (deleted in abc)',
			file: 'ci.yml',
			ref: 'server/register-hooks.mjs',
			rung: 1,
		},
		{
			text: 'Dockerfile:2 references server/register-hooks.mjs, which does not exist',
			file: 'Dockerfile',
			ref: 'server/register-hooks.mjs',
			rung: 7,
		},
		{ text: 'CI skips format', rung: 1 },
		{ text: 'CI skips format', rung: 1 },
	]
	const deduped = dedupeFindings(findings)
	assert.equal(deduped.length, 3)
	assert.equal(deduped[0].file, 'ci.yml')
	assert.equal(deduped[1].file, 'Dockerfile')
	assert.equal(deduped[2].text, 'CI skips format')
	const { result } = mergePrevious(
		{
			...validAudit(),
			findings: [findings[0]],
			verify: { results: [] },
		},
		validAudit({ findings: [findings[1], findings[3]] }),
	)
	assert.equal(result.findings.length, 2)
})

test('mergePrevious reports kept triage', () => {
	const triage = {
		system: 'labels',
		priorities: ['P0', 'P1', 'P2', 'P3'],
		decision: 'needs-decision',
		existing: false,
		evidence: 'interview',
	}
	const next = {
		...validAudit(),
		findings: [],
		verify: { results: [] },
		rungs: validAudit().rungs.map((r) => ({
			...r,
			score: null,
			notes: '',
			evidence: [],
			checked: [],
		})),
	}
	const previous = { ...next, triage }
	const { result, carry } = mergePrevious(next, previous)
	assert.deepEqual(result.triage, triage)
	assert.equal(carry.triage, true)
	assert.match(formatCarryOver(carry), /Kept previous triage/)
})

test('mergePrevious collapses a saved finding that has no ref into the detected one', () => {
	const detected = {
		text: 'ci.yml:3 references server/register-hooks.mjs, which does not exist',
		file: 'ci.yml',
		ref: 'server/register-hooks.mjs',
		rung: 1,
	}
	const saved = { text: detected.text, file: 'ci.yml', rung: 1 }
	const { result } = mergePrevious(
		{ ...validAudit(), findings: [detected], verify: { results: [] } },
		validAudit({ findings: [saved] }),
	)
	assert.deepEqual(result.findings, [detected])
})

test('formatVerifyLine skips missing durationMs and marks carried-over results', () => {
	assert.equal(
		formatVerifyLine({ command: 'npm run validate', exitCode: 1 }),
		'npm run validate → exit 1',
	)
	assert.doesNotMatch(formatVerifyLine({ command: 'x', exitCode: 0 }), /NaN/)
	assert.match(
		formatVerifyLine({
			command: 'npm run validate',
			exitCode: 0,
			durationMs: 1500,
			carriedOver: true,
		}),
		/1\.5s.*carried over; not re-run/,
	)
})

test('audit main exits 0 after a successful write even when verify failed', (t) => {
	const root = tempRepo(t, {
		'package.json': JSON.stringify({ scripts: { validate: 'false' } }),
	})
	const out = path.join(root, '.autopilot', 'before.json')
	const logs = []
	const status = auditMain(
		[root, '--out', out, '--verify', 'false', '--timeout', '5'],
		{ log: (line) => logs.push(line) },
	)
	assert.equal(status, 0)
	const written = JSON.parse(readFileSync(out, 'utf8'))
	assert.equal(written.verify.results[0].exitCode, 1)
	assert.match(auditUsage, /Exit codes: 0 =/)
	assert.doesNotMatch(logs.join('\n'), /NaN/)
})

test('audit main reports carry-over and does not merge another repo silently', (t) => {
	const root = tempRepo(t, {
		'package.json': JSON.stringify({ name: 'app' }),
	})
	const out = path.join(root, '.autopilot', 'before.json')
	const firstLogs = []
	assert.equal(
		auditMain([root, '--out', out], { log: (line) => firstLogs.push(line) }),
		0,
	)
	const first = JSON.parse(readFileSync(out, 'utf8'))
	first.rungs[0].score = 'partial'
	first.rungs[0].notes = 'why'
	first.rungs[0].evidence = ['package.json']
	first.verify.results = [
		{ command: 'npm run validate', exitCode: 1, note: 'hand-written' },
	]
	first.findings = [
		{
			text: 'ci.yml:1 references gone.mjs, which does not exist',
			file: 'ci.yml',
			ref: 'gone.mjs',
			rung: 1,
		},
		{
			text: 'ci.yml:2 references gone.mjs, which does not exist (deleted)',
			file: 'ci.yml',
			ref: 'gone.mjs',
			rung: 1,
		},
	]
	writeFileSync(out, `${JSON.stringify(first, null, '\t')}\n`)

	const rerunLogs = []
	assert.equal(
		auditMain([root, '--out', out], { log: (line) => rerunLogs.push(line) }),
		0,
	)
	const rerunText = rerunLogs.join('\n')
	assert.match(rerunText, /Carry-over from existing --out file/)
	assert.match(rerunText, /Verify commands not re-run this time/)
	assert.match(rerunText, /carried over; not re-run/)
	const rerun = JSON.parse(readFileSync(out, 'utf8'))
	assert.equal(rerun.rungs[0].score, 'partial')
	assert.equal(rerun.verify.results[0].carriedOver, true)
	assert.equal(rerun.findings.filter((f) => f.ref === 'gone.mjs').length, 1)

	const other = tempRepo(t, {
		'package.json': JSON.stringify({ name: 'other' }),
	})
	const foreignLogs = []
	assert.equal(
		auditMain([other, '--out', out], {
			log: (line) => foreignLogs.push(line),
		}),
		0,
	)
	assert.match(foreignLogs.join('\n'), /Not merging .* Starting fresh/)
	const fresh = JSON.parse(readFileSync(out, 'utf8'))
	assert.equal(fresh.repo.name, path.basename(other))
	assert.equal(fresh.rungs[0].score, null)
	assert.equal(fresh.verify.results.length, 0)
})

test('validate accepts a complete audit and plan', () => {
	assert.deepEqual(validate(validAudit()), [])
	assert.deepEqual(validate(validAudit({ plan })), [])
})

test('validate rejects malformed audits with specific errors', () => {
	const cases = [
		[validAudit({ rungs: validAudit().rungs.slice(1) }), /exactly 13 entries/],
		[
			validAudit({ rungs: validAudit().rungs.slice(1) }),
			/rung 1 \(.*\) is missing/,
		],
		[withRung(3, { pillar: 'review' }), /rung 3\.pillar must be "good-prs"/],
		[withRung(3, { score: 'maybe' }), /rung 3\.score must be one of/],
		[withRung(5, { evidence: [] }), /rung 5 is done but has no evidence/],
		[
			withRung(9, { notes: '' }),
			/rung 9 is unknown: notes must say why and what to ask/,
		],
		[
			withRung(2, { evidence: [], checked: [] }),
			/rung 2 is missing: list what you looked for/,
		],
		[
			withRung(4, { inferred: true, notes: '' }),
			/rung 4 is inferred: notes must say why/,
		],
		[validAudit({ verify: { results: [] } }), /verify\.results must list/],
		[
			validAudit({
				verify: { results: [{ command: 'x', exitCode: 0, skipped: 'y' }] },
			}),
			/not both/,
		],
		[validAudit({ schemaVersion: 2 }), /schemaVersion must be 1/],
		[validAudit({ stack: {} }), /stack\.summary/],
		[validAudit({ findings: [{ text: '' }] }), /findings\[0\]\.text/],
	]
	for (const [audit, pattern] of cases) {
		const errors = validate(audit)
		assert.ok(
			errors.some((e) => pattern.test(e)),
			`${pattern} not in ${JSON.stringify(errors)}`,
		)
	}
	assert.deepEqual(validate(null), ['audit must be a JSON object'])
})

test('validate enforces plan rules for partial, unknown, done, and order', () => {
	const errorsFor = (rows) => validate(validAudit({ plan: rows }))
	assert.ok(
		errorsFor([plan[0]]).some((e) =>
			/rung 2 is missing but has no plan row/.test(e),
		),
	)
	assert.ok(
		errorsFor([...plan, { ...plan[0], rung: 9 }]).some((e) =>
			/rung 9 is unknown; .*ask or verify first/.test(e),
		),
	)
	assert.ok(
		errorsFor([...plan, { ...plan[0], rung: 5 }]).some((e) =>
			/rung 5 is done; only partial or missing/.test(e),
		),
	)
	assert.ok(errorsFor([plan[1], plan[0]]).some((e) => /ladder order/.test(e)))
	assert.ok(
		errorsFor([plan[0], plan[0], plan[1]]).some((e) =>
			/more than one plan row/.test(e),
		),
	)
	assert.ok(
		errorsFor([{ ...plan[0], effort: 'XL', door: 'maybe', files: [] }, plan[1]])
			.length >= 3,
	)
	assert.ok(
		errorsFor([{ ...plan[0], pillar: 'review' }, plan[1]]).some((e) =>
			/plan\[0\]\.pillar/.test(e),
		),
	)
	assert.ok(
		validate(
			validAudit({ prs: [{ rung: 1, url: 'u', status: 'closed' }] }),
		).some((e) => /prs\[0\]\.status/.test(e)),
	)
})

test('renderText groups rungs by pillar, shows before → after, and the plan table', () => {
	const before = validAudit()
	const after = withRung(1, { score: 'done' })
	after.plan = [plan[1]]
	after.prs = [
		{ rung: 1, url: 'https://example.test/pull/1', status: 'merged' },
	]
	const text = renderText(after, before)
	assert.match(text, /P1 · Good PRs from the start/)
	assert.match(text, /P3 · Limit blast radius/)
	assert.match(text, /Keep improving/)
	assert.match(text, /partial → done/)
	assert.match(
		text,
		/Open questions \(resolve before the setup PR\):\n  - Rung 9/,
	)
	assert.match(
		text,
		/\| Rung \| Pillar \| Title \| Files \| Effort \| Door \| Needs \|/,
	)
	// Rung 1 is done now, so rung 2 has no open needs.
	assert.match(
		planTable(after),
		/\| 2 \| P1 \| Seed decisions \| docs\/decisions\/README\.md \| S \| two-way \| - \|/,
	)
	assert.match(
		planTable(validAudit({ plan })),
		/\| 2 \| P1 \| Seed decisions .* \| 1 \|/,
	)
	assert.match(text, /rung 1: merged https:\/\/example\.test\/pull\/1/)
})

test('renderHtml is self-contained and escapes content', () => {
	const audit = withRung(1, { notes: '<script>alert(1)</script>' })
	const out = renderHtml({ ...audit, plan }, validAudit())
	assert.match(out, /^<!doctype html>/)
	assert.ok(!out.includes('<script>alert(1)</script>'))
	assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
	assert.match(out, /<h2>Plan<\/h2>/)
	assert.match(out, /P2 · Review, iteration, verification/)
})

test('main validates in every mode, writes HTML, and --json reports errors', () => {
	const files = {
		'good.json': JSON.stringify(validAudit({ plan })),
		'bad.json': JSON.stringify(withRung(3, { score: 'maybe' })),
		'broken.json': '{ nope',
	}
	const logs = []
	const written = {}
	const io = {
		read: (file) => files[file],
		write: (file, text) => {
			written[file] = text
		},
		log: (line) => logs.push(line),
	}
	assert.equal(main(['good.json', '--html', 'out.html'], io), 0)
	assert.match(written['out.html'], /Autopilot audit: app/)
	assert.match(
		logs.join('\n'),
		/Score: done 1 · partial 1 · missing 1 · unknown 1 · n\/a 9/,
	)
	assert.throws(
		() => main(['bad.json'], io),
		/Invalid audit \(1 problem\):\n- bad\.json: rung 3\.score/,
	)
	assert.throws(
		() => main(['broken.json'], io),
		/broken\.json is not valid JSON/,
	)
	logs.length = 0
	assert.equal(main(['bad.json', '--json'], io), 1)
	assert.equal(JSON.parse(logs[0]).ok, false)
	logs.length = 0
	assert.equal(main(['good.json', '--json', '--before', 'good.json'], io), 0)
	assert.deepEqual(JSON.parse(logs[0]).summary, {
		done: 1,
		partial: 1,
		missing: 1,
		unknown: 1,
		'n/a': 9,
	})
	assert.throws(() => main(['good.json', '--nope'], io), /Unknown option/)
})

test('re-running on a 12-rung audit moves Cleanup judgments to rungs 12 and 13', () => {
	const old = {
		repo: { name: 'app' },
		rungs: [
			...Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				name: `r${i + 1}`,
			})),
			{ id: 11, name: 'Cleanup issues', score: 'partial', notes: 'cleanup' },
			{ id: 12, name: 'Signals + cleanup cron agents', score: 'missing' },
		],
		plan: [{ rung: 12, title: 'cron' }],
		findings: [{ text: 'f', rung: 11 }],
		host: { host: 'github', facts: [{ rung: 11, text: 'x', evidence: 'y' }] },
	}
	const migrated = migrateRungIds(old)
	assert.equal(migrated.rungs.find((r) => r.id === 12).notes, 'cleanup')
	assert.equal(migrated.rungs.find((r) => r.id === 13).score, 'missing')
	assert.equal(
		migrated.rungs.some((r) => r.id === 11),
		false,
	)
	assert.equal(migrated.plan[0].rung, 13)
	assert.equal(migrated.findings[0].rung, 12)
	assert.equal(migrated.host.facts[0].rung, 12)
	const next = {
		repo: { name: 'app' },
		findings: [],
		verify: { results: [] },
		stack: { summary: '' },
		rungs: detectRungs.map((r) => ({
			...r,
			score: null,
			notes: '',
			evidence: [],
			checked: [],
		})),
	}
	const { result: merged } = mergePrevious(next, old)
	assert.equal(merged.rungs.find((r) => r.id === 11).score, null)
	assert.equal(merged.rungs.find((r) => r.id === 12).score, 'partial')
	// A current 13-rung audit is left alone.
	const current = {
		rungs: detectRungs.map((r) => ({ id: r.id, name: r.name })),
	}
	assert.equal(migrateRungIds(current), current)
})

test('triage validation is shared by the triage command and the report', () => {
	const good = {
		system: 'labels',
		priorities: ['P0', 'P1', 'P2', 'P3'],
		decision: 'needs-decision',
		evidence: 'gh label list',
	}
	assert.deepEqual(validateTriage(good), [])
	assert.deepEqual(validate(validAudit({ triage: good })), [])
	const problems = validate(
		validAudit({
			triage: { ...good, system: 'board', priorities: ['P0'], existing: 'yes' },
		}),
	)
	assert.ok(
		problems.includes(
			'triage: system must be one of labels, project-field, tracker-field, none',
		),
	)
	assert.ok(
		problems.includes(
			'triage: priorities must list at least two values, highest first',
		),
	)
	assert.ok(problems.includes('triage: existing must be a boolean'))
})
