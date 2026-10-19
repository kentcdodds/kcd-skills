import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
	addFinding,
	addHostFacts,
	addPlanRow,
	setScore,
} from '../skills/autopilot/scripts/audit-edit.mjs'
import {
	exitCodeFor,
	githubAdapterProblem,
	readState,
	runWithInput,
} from '../skills/autopilot/scripts/ship-pr.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const bin = path.join(repo, 'bin', 'kcd-skills.mjs')
const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'))

function cli(args, options = {}) {
	return spawnSync(process.execPath, [bin, ...args], {
		encoding: 'utf8',
		...options,
	})
}

function tempDir(t) {
	const dir = mkdtempSync(path.join(tmpdir(), 'kcd-skills-'))
	t.after(() => rmSync(dir, { recursive: true, force: true }))
	return dir
}

test('help lists skills and autopilot commands', () => {
	const result = cli(['--help'])
	assert.equal(result.status, 0)
	for (const command of ['audit', 'score', 'host', 'report', 'ship-pr']) {
		assert.match(result.stdout, new RegExp(`autopilot ${command} `))
	}
	assert.match(result.stdout, /visual-recap/)
	assert.equal(cli(['--version']).stdout.trim(), pkg.version)
})

test('a skill with no command prints its instructions for this version', () => {
	const result = cli(['autopilot'])
	assert.equal(result.status, 0)
	const skill = readFileSync(
		path.join(repo, 'skills/autopilot/SKILL.md'),
		'utf8',
	)
	assert.equal(
		result.stdout,
		`<!-- kcd-skills@${pkg.version} autopilot -->\n${skill}`,
	)
	assert.match(cli(['autopilot', 'templates']).stdout, /^# Templates/)
})

test('unknown skills and commands exit 1 and list what exists', () => {
	const command = cli(['autopilot', 'nope'])
	assert.equal(command.status, 1)
	assert.match(command.stderr, /autopilot commands: audit, .*ship-pr/)
	const skill = cli(['nope'])
	assert.equal(skill.status, 1)
	assert.match(skill.stderr, /Skills: .*autopilot/)
})

test('scripts and the bin run through symlinked paths (macOS /var -> /private/var)', (t) => {
	const dir = tempDir(t)
	symlinkSync(repo, path.join(dir, 'link'))
	const script = spawnSync(
		process.execPath,
		[
			path.join(dir, 'link/skills/autopilot/scripts/audit-detect.mjs'),
			'--help',
		],
		{ encoding: 'utf8' },
	)
	assert.match(script.stdout, /Usage: kcd-skills autopilot audit/)
	const viaLink = spawnSync(
		process.execPath,
		[path.join(dir, 'link/bin/kcd-skills.mjs'), '--version'],
		{ encoding: 'utf8' },
	)
	assert.equal(viaLink.stdout.trim(), pkg.version)
})

test('audit, score, finding, host, plan add, and report work end to end', (t) => {
	const dir = tempDir(t)
	const file = path.join(dir, 'audit.json')
	assert.equal(cli(['autopilot', 'audit', repo, '--out', file]).status, 0)
	const missingNote = cli(['autopilot', 'score', file, '4', 'partial'])
	assert.equal(missingNote.status, 1)
	assert.match(missingNote.stderr, /rung 4 is partial: notes must say why/)
	assert.equal(
		cli([
			'autopilot',
			'score',
			file,
			'4',
			'partial',
			'--evidence',
			'package.json',
			'--note',
			'no CLI',
		]).status,
		0,
	)
	assert.equal(
		cli(['autopilot', 'finding', file, 'CI skips format', '--rung', '1'])
			.status,
		0,
	)
	const facts = JSON.stringify({
		host: 'gitlab',
		facts: [{ rung: 7, text: 'no reviewers', evidence: 'glab mr list' }],
	})
	assert.equal(
		cli(['autopilot', 'host', file, '--input', '-'], { input: facts }).status,
		0,
	)
	assert.equal(
		cli([
			'autopilot',
			'plan',
			'add',
			file,
			'4',
			'--title',
			'Control CLI',
			'--file',
			'tools/control.mjs',
			'--effort',
			'M',
			'--door',
			'two-way',
		]).status,
		0,
	)
	const audit = JSON.parse(readFileSync(file, 'utf8'))
	assert.equal(audit.rungs.find((r) => r.id === 4).notes, 'no CLI')
	assert.deepEqual(audit.host.facts, [
		{ rung: 7, text: 'no reviewers', evidence: 'glab mr list' },
	])
	assert.equal(audit.plan[0].title, 'Control CLI')
	// Re-running the audit keeps the agent's edits.
	assert.equal(cli(['autopilot', 'audit', repo, '--out', file]).status, 0)
	const rerun = JSON.parse(readFileSync(file, 'utf8'))
	assert.equal(rerun.host.host, 'gitlab')
	assert.equal(rerun.plan.length, 1)
	const request = cli(['autopilot', 'host', 'request'])
	assert.match(request.stdout, /"facts"/)
})

test('audit edits report only problems with what they touched', () => {
	const audit = {
		rungs: [{ id: 2, pillar: 'good-prs', score: null, evidence: [] }],
	}
	assert.deepEqual(setScore(audit, 2, 'missing', { checked: ['docs/'] }), [])
	assert.throws(() => setScore(audit, 2, 'great'), /score must be one of/)
	assert.deepEqual(addFinding(audit, 'x', 2), [])
	assert.match(addFinding(audit, '')[0], /findings\[1\]\.text/)
	assert.deepEqual(
		addPlanRow(audit, {
			rung: 2,
			title: 'ADRs',
			files: ['docs/decisions/'],
			effort: 'S',
			door: 'two-way',
		}),
		[],
	)
	assert.match(
		addHostFacts(audit, { host: 'github', facts: [{ text: 'x' }] })[0],
		/evidence must name the command or URL/,
	)
})

test('ship-pr --input decides from agent-supplied state on any host', () => {
	const config = { reviewers: { low: [], medium: [], high: [] } }
	const options = { input: 'state.json', risk: 'low', merge: true }
	const run = (state) =>
		runWithInput(options, config, () => JSON.stringify(state)).decision
	const draft = run({ number: 4, state: 'OPEN', draft: true })
	assert.equal(draft.step, 'mark-ready')
	assert.equal(draft.command, undefined)
	assert.match(draft.reason, /with your tools, then run again/)
	assert.equal(exitCodeFor(draft.step), 10)
	const ready = run({
		url: 'https://gitlab.example/acme/app/-/merge_requests/4',
		state: 'OPEN',
		checks: [{ name: 'test', status: 'success' }],
	})
	assert.equal(ready.step, 'merge')
	assert.equal(
		run({
			number: 4,
			state: 'OPEN',
			checks: [{ name: 'ci', status: 'pending' }],
		}).step,
		'wait',
	)
	assert.throws(
		() => readState({ number: 4, state: 'open', checks: [{}] }),
		/state must be one of OPEN.*\n- checks\[0\]\.name/s,
	)
})

test('ship-pr explains how to supply state when gh is unavailable', (t) => {
	const missing = Object.assign(new Error('spawn gh ENOENT'), {
		code: 'ENOENT',
	})
	assert.equal(
		githubAdapterProblem(() => {
			throw missing
		}),
		'gh is not installed.',
	)
	const dir = tempDir(t)
	const result = cli(['autopilot', 'ship-pr', '12'], {
		cwd: dir,
		env: { ...process.env, PATH: dir },
	})
	assert.equal(result.status, 30)
	assert.match(result.stderr, /gh is not installed/)
	assert.match(result.stderr, /ship-pr --input state\.json/)
	writeFileSync(
		path.join(dir, 'state.json'),
		JSON.stringify({ number: 12, state: 'MERGED' }),
	)
	const merged = cli(
		['autopilot', 'ship-pr', '--input', 'state.json', '--json'],
		{ cwd: dir, env: { ...process.env, PATH: dir } },
	)
	assert.equal(merged.status, 0)
	assert.equal(JSON.parse(merged.stdout).step, 'done')
})

test('the package ships the bin and every skill file, not the tests', () => {
	const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
		cwd: repo,
		encoding: 'utf8',
	})
	assert.equal(result.status, 0, result.stderr)
	const files = JSON.parse(result.stdout)[0].files.map((f) => f.path)
	assert.ok(files.includes('bin/kcd-skills.mjs'))
	assert.ok(files.includes('skills/autopilot/SKILL.md'))
	assert.ok(files.includes('skills/autopilot/scripts/ship-pr.mjs'))
	assert.ok(files.includes('skills/autopilot/references/templates.md'))
	assert.ok(!files.some((f) => f.startsWith('test/')))
	assert.equal(pkg.bin['kcd-skills'], 'bin/kcd-skills.mjs')
	assert.equal(pkg.private, undefined)
})
