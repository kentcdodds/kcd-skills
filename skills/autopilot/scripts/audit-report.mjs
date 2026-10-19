#!/usr/bin/env node
// Validate an autopilot audit JSON and render it as a terminal report, an HTML
// report (--html out.html), or a machine-readable check (--json). Every mode
// validates first and exits 1 listing every problem. --before adds a
// before → after column for the hand-off report.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Keep in sync with audit-detect.mjs (a test checks this). `needs` = rungs
// whose PRs must merge before this rung's PR opens — the merge-order
// dependency map (policy); keep prose in references/templates.md in sync.
export const rungs = [
	{
		id: 1,
		pillar: 'good-prs',
		name: 'Agent map + one verify command in CI',
		needs: [],
	},
	{ id: 2, pillar: 'good-prs', name: 'Decisions directory', needs: [1] },
	{ id: 3, pillar: 'good-prs', name: 'Primitives catalog', needs: [1] },
	{
		id: 4,
		pillar: 'good-prs',
		name: 'Self-verification: control CLI + skill',
		needs: [1],
	},
	{ id: 5, pillar: 'good-prs', name: 'PR template', needs: [1] },
	{ id: 6, pillar: 'review', name: 'Ship loop', needs: [1, 5] },
	{
		id: 7,
		pillar: 'review',
		name: 'AI reviewers, previews, agent merge, deploy watch',
		needs: [4, 6],
	},
	{
		id: 8,
		pillar: 'blast-radius',
		name: 'Flags + rollback runbook',
		needs: [1],
	},
	{
		id: 9,
		pillar: 'blast-radius',
		name: 'Backups + tested restore',
		needs: [1],
	},
	{ id: 10, pillar: 'improve', name: 'Friction form', needs: [6] },
	{
		id: 11,
		pillar: 'improve',
		name: 'Triage: priority + decision marker',
		needs: [10],
	},
	{ id: 12, pillar: 'improve', name: 'Cleanup issues', needs: [5, 11] },
	{
		id: 13,
		pillar: 'improve',
		name: 'Signals + cleanup cron agents',
		needs: [10, 11, 12],
	},
]

export const pillars = {
	'good-prs': 'P1 · Good PRs from the start',
	review: 'P2 · Review, iteration, verification',
	'blast-radius': 'P3 · Limit blast radius',
	improve: 'KI · Keep improving',
}

export const scores = ['done', 'partial', 'missing', 'unknown', 'n/a']
const efforts = ['S', 'M', 'L']
const doors = ['two-way', 'one-way']
const prStatuses = ['merged', 'open', 'parked']

const isStringArray = (value) =>
	Array.isArray(value) &&
	value.every((item) => typeof item === 'string' && item.trim())
const isText = (value) => typeof value === 'string' && value.trim().length > 0

export const triageSystems = [
	'labels',
	'project-field',
	'tracker-field',
	'none',
]

// Shared by `kcd-skills autopilot triage` and the report.
export function validateTriage(triage) {
	if (!triage || typeof triage !== 'object' || Array.isArray(triage)) {
		return ['must be a JSON object (see kcd-skills autopilot triage request)']
	}
	const errors = []
	if (!triageSystems.includes(triage.system)) {
		errors.push(`system must be one of ${triageSystems.join(', ')}`)
	}
	if (!isStringArray(triage.priorities) || triage.priorities.length < 2) {
		errors.push('priorities must list at least two values, highest first')
	}
	if (!isText(triage.decision)) {
		errors.push(
			'decision must name the marker for issues that need a human call',
		)
	}
	if (!isText(triage.evidence)) {
		errors.push(
			'evidence must name the command, URL, or "interview" that shows it',
		)
	}
	if (triage.existing !== undefined && typeof triage.existing !== 'boolean') {
		errors.push('existing must be a boolean')
	}
	if (triage.tracker !== undefined && !isText(triage.tracker)) {
		errors.push('tracker must be a non-empty string')
	}
	return errors
}

export function validate(audit) {
	const errors = []
	const err = (message) => errors.push(message)
	if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
		return ['audit must be a JSON object']
	}
	if (audit.schemaVersion !== 1) err('schemaVersion must be 1')
	if (!isText(audit.repo?.name)) err('repo.name must be a non-empty string')
	if (!isText(audit.stack?.summary))
		err('stack.summary must be a non-empty string')
	if (
		audit.stack?.evidence !== undefined &&
		!isStringArray(audit.stack.evidence)
	) {
		err('stack.evidence must be an array of paths')
	}
	const results = audit.verify?.results
	if (!Array.isArray(results) || results.length === 0) {
		err(
			'verify.results must list at least one command you ran (or one with "skipped": "<reason>")',
		)
	} else {
		results.forEach((result, index) => {
			const where = `verify.results[${index}]`
			if (!isText(result?.command))
				err(`${where}.command must be a non-empty string`)
			const ran = Number.isInteger(result?.exitCode)
			const skipped = isText(result?.skipped)
			if (ran === skipped)
				err(
					`${where} needs an integer exitCode or a "skipped" reason, not both`,
				)
		})
	}
	if (audit.host !== undefined) {
		if (!isText(audit.host?.host) || !Array.isArray(audit.host?.facts))
			err(
				'host must be { host, facts: [] } (see kcd-skills autopilot host request)',
			)
		else
			audit.host.facts.forEach((fact, index) => {
				if (!isText(fact?.text) || !isText(fact?.evidence))
					err(`host.facts[${index}] needs text and evidence`)
			})
	}
	if (audit.triage !== undefined) {
		for (const problem of validateTriage(audit.triage))
			err(`triage: ${problem}`)
	}
	if (audit.findings !== undefined) {
		if (!Array.isArray(audit.findings)) err('findings must be an array')
		else
			audit.findings.forEach((finding, index) => {
				if (!isText(finding?.text))
					err(`findings[${index}].text must be a non-empty string`)
				if (
					finding?.rung !== undefined &&
					!rungs.some((r) => r.id === finding.rung)
				) {
					err(`findings[${index}].rung must be 1-13`)
				}
			})
	}
	if (!Array.isArray(audit.rungs)) {
		err('rungs must be an array of 13 rungs')
		return errors
	}
	if (audit.rungs.length !== rungs.length)
		err(
			`rungs must have exactly ${rungs.length} entries (got ${audit.rungs.length})`,
		)
	const seen = new Set()
	for (const [index, rung] of audit.rungs.entries()) {
		const known = rungs.find((r) => r.id === rung?.id)
		const where = known ? `rung ${rung.id}` : `rungs[${index}]`
		if (!known) {
			err(`${where}.id must be an integer 1-13`)
			continue
		}
		if (seen.has(rung.id)) err(`${where} appears more than once`)
		seen.add(rung.id)
		if (rung.pillar !== known.pillar)
			err(`${where}.pillar must be "${known.pillar}"`)
		if (!scores.includes(rung.score))
			err(
				`${where}.score must be one of ${scores.join(', ')} (got ${JSON.stringify(rung.score)})`,
			)
		if (!isStringArray(rung.evidence ?? []))
			err(`${where}.evidence must be an array of paths`)
		if (rung.checked !== undefined && !isStringArray(rung.checked))
			err(`${where}.checked must be an array of strings`)
		if (rung.inferred !== undefined && typeof rung.inferred !== 'boolean')
			err(`${where}.inferred must be a boolean`)
		if (rung.notes !== undefined && typeof rung.notes !== 'string')
			err(`${where}.notes must be a string`)
		const evidence = rung.evidence ?? []
		if (
			['done', 'partial'].includes(rung.score) &&
			evidence.length === 0 &&
			!rung.inferred
		) {
			err(
				`${where} is ${rung.score} but has no evidence paths (or set "inferred": true with notes)`,
			)
		}
		if (
			['missing', 'unknown'].includes(rung.score) &&
			evidence.length === 0 &&
			!(rung.checked ?? []).length
		) {
			err(`${where} is ${rung.score}: list what you looked for in checked`)
		}
		if (
			(['partial', 'unknown', 'n/a'].includes(rung.score) || rung.inferred) &&
			!isText(rung.notes)
		) {
			err(
				`${where} is ${rung.inferred ? 'inferred' : rung.score}: notes must say why${rung.score === 'unknown' ? ' and what to ask or verify' : ''}`,
			)
		}
	}
	for (const r of rungs)
		if (!seen.has(r.id)) err(`rung ${r.id} (${r.name}) is missing`)
	if (audit.plan !== undefined) validatePlan(audit, err)
	if (audit.prs !== undefined) {
		if (!Array.isArray(audit.prs)) err('prs must be an array')
		else
			audit.prs.forEach((pr, index) => {
				const where = `prs[${index}]`
				if (!rungs.some((r) => r.id === pr?.rung))
					err(`${where}.rung must be 1-13`)
				if (!isText(pr?.url)) err(`${where}.url must be a non-empty string`)
				if (!prStatuses.includes(pr?.status))
					err(`${where}.status must be one of ${prStatuses.join(', ')}`)
			})
	}
	return errors
}

function validatePlan(audit, err) {
	if (!Array.isArray(audit.plan)) {
		err('plan must be an array of rows')
		return
	}
	const byId = new Map((audit.rungs ?? []).map((rung) => [rung?.id, rung]))
	let previous = 0
	const planned = new Set()
	audit.plan.forEach((row, index) => {
		const where = `plan[${index}]`
		const rung = byId.get(row?.rung)
		if (!rung) {
			err(`${where}.rung must be a rung id 1-13`)
			return
		}
		if (planned.has(row.rung))
			err(`${where}: rung ${row.rung} has more than one PR (one PR per rung)`)
		planned.add(row.rung)
		if (row.rung < previous) err(`${where}: rows must be in ladder order`)
		previous = row.rung
		if (!['partial', 'missing'].includes(rung.score)) {
			err(
				`${where}: rung ${row.rung} is ${rung.score}; only partial or missing rungs get a PR${rung.score === 'unknown' ? ' (ask or verify first)' : ''}`,
			)
		}
		if (row.pillar !== undefined && row.pillar !== rung.pillar)
			err(`${where}.pillar must be "${rung.pillar}"`)
		if (!isText(row.title)) err(`${where}.title must be a non-empty string`)
		if (!isStringArray(row.files) || row.files.length === 0)
			err(`${where}.files must list at least one path`)
		if (!efforts.includes(row.effort))
			err(`${where}.effort must be one of ${efforts.join(', ')}`)
		if (!doors.includes(row.door))
			err(`${where}.door must be one of ${doors.join(', ')}`)
	})
	for (const rung of audit.rungs ?? []) {
		if (['partial', 'missing'].includes(rung?.score) && !planned.has(rung.id)) {
			err(
				`plan: rung ${rung.id} is ${rung.score} but has no PR row (or mark it n/a with a reason)`,
			)
		}
	}
}

export function parseAudit(text, label = 'audit') {
	let audit
	try {
		audit = JSON.parse(text)
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${error.message}`)
	}
	return audit
}

// Rungs in `needs` that still need work (not done, not n/a).
export function openNeeds(audit, id) {
	const byId = new Map(audit.rungs.map((rung) => [rung.id, rung]))
	return rungs
		.find((r) => r.id === id)
		.needs.filter((need) => !['done', 'n/a'].includes(byId.get(need)?.score))
}

// "checked" matters when nothing supports the score.
const showChecked = (rung) =>
	(rung.checked ?? []).length > 0 &&
	(!rung.evidence?.length || ['missing', 'unknown'].includes(rung.score))

export function summary(audit) {
	const counts = Object.fromEntries(scores.map((score) => [score, 0]))
	for (const rung of audit.rungs) counts[rung.score]++
	return counts
}

function planRows(audit) {
	return (audit.plan ?? []).map((row) => {
		const rung = audit.rungs.find((r) => r.id === row.rung)
		const needs = openNeeds(audit, row.rung)
		return {
			rung: row.rung,
			pillar: pillars[rung.pillar].split(' · ')[0],
			title: row.title,
			files: row.files.join(', '),
			effort: row.effort,
			door: row.door,
			needs: needs.length ? needs.join(', ') : '—',
		}
	})
}

const planHeader = [
	'Rung',
	'Pillar',
	'PR title',
	'Files',
	'Effort',
	'Door',
	'Needs',
]

export function planTable(audit) {
	const rows = planRows(audit)
	if (!rows.length) return ''
	const escape = (value) => String(value).replace(/\|/g, '\\|')
	return [
		`| ${planHeader.join(' | ')} |`,
		`| ${planHeader.map(() => '---').join(' | ')} |`,
		...rows.map((row) => `| ${Object.values(row).map(escape).join(' | ')} |`),
	].join('\n')
}

function scoreCell(audit, before, id) {
	const now = audit.rungs.find((r) => r.id === id).score
	if (!before) return now
	const then = before.rungs.find((r) => r.id === id)?.score ?? '?'
	return then === now ? now : `${then} → ${now}`
}

const openQuestions = (audit) =>
	audit.rungs
		.filter((rung) => rung.score === 'unknown')
		.map((rung) => `Rung ${rung.id} (${rung.name}): ${rung.notes}`)

function formatVerifyResult(r) {
	const carried = r.carriedOver ? ' [carried over; not re-run]' : ''
	if (r.skipped) return `${r.command} → skipped: ${r.skipped}${carried}`
	const duration =
		typeof r.durationMs === 'number'
			? ` (${(r.durationMs / 1000).toFixed(1)}s)`
			: ''
	return `${r.command} → exit ${r.exitCode}${duration}${carried}`
}

export function triageLine(t) {
	return `${t.priorities.join(' > ')} (${t.system}${t.tracker ? ` on ${t.tracker}` : ''}${t.existing ? ', existing' : ', adopted default'}); decision marker ${t.decision} (${t.evidence})`
}

export function renderText(audit, before) {
	const verify = audit.verify.results.map(formatVerifyResult)
	const lines = [
		`Autopilot audit: ${audit.repo.name}${audit.repo.commit ? ` @ ${audit.repo.commit}` : ''}${before ? ' (before → after)' : ''}`,
		`Stack: ${audit.stack.summary}`,
		...verify.map((line, i) => `${i ? '       ' : 'Verify:'} ${line}`),
	]
	for (const [pillar, title] of Object.entries(pillars)) {
		lines.push('', title)
		for (const rung of audit.rungs
			.filter((r) => r.pillar === pillar)
			.sort((a, b) => a.id - b.id)) {
			const tag = rung.inferred ? ' (inferred)' : ''
			lines.push(
				`  ${String(rung.id).padStart(2)}. ${rung.name.padEnd(50)} ${scoreCell(audit, before, rung.id)}${tag}`,
			)
			if (rung.evidence?.length) {
				lines.push(`      evidence: ${rung.evidence.join(', ')}`)
			}
			if (showChecked(rung)) {
				lines.push(`      checked: ${rung.checked.join('; ')}`)
			}
			if (rung.notes) lines.push(`      ${rung.notes}`)
		}
	}
	const counts = summary(audit)
	lines.push(
		'',
		`Score: ${scores.map((score) => `${score} ${counts[score]}`).join(' · ')}`,
	)
	if (audit.triage) {
		lines.push('', `Triage: ${triageLine(audit.triage)}`)
	}
	if (audit.host?.facts?.length) {
		lines.push(
			'',
			`Host facts (${audit.host.host}):`,
			...audit.host.facts.map(
				(f) =>
					`  - ${f.rung ? `[rung ${f.rung}] ` : ''}${f.text} (${f.evidence})`,
			),
		)
	}
	if (audit.findings?.length) {
		lines.push(
			'',
			'Findings:',
			...audit.findings.map(
				(f) => `  - ${f.rung ? `[rung ${f.rung}] ` : ''}${f.text}`,
			),
		)
	}
	const questions = openQuestions(audit)
	if (questions.length)
		lines.push(
			'',
			'Open questions (no PR until answered):',
			...questions.map((q) => `  - ${q}`),
		)
	const table = planTable(audit)
	if (table) lines.push('', 'Plan:', table)
	if (audit.prs?.length) {
		lines.push(
			'',
			'PRs:',
			...audit.prs.map(
				(pr) =>
					`  - rung ${pr.rung}: ${pr.status} ${pr.url}${pr.note ? ` (${pr.note})` : ''}`,
			),
		)
	}
	return lines.join('\n')
}

const html = (value) =>
	String(value ?? '').replace(
		/[&<>"']/g,
		(char) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
				char
			],
	)

export function renderHtml(audit, before) {
	const counts = summary(audit)
	const badge = (score) =>
		`<span class="badge ${html(score.replace('/', ''))}">${html(score)}</span>`
	const cell = (id) => {
		const now = audit.rungs.find((r) => r.id === id).score
		const then = before?.rungs.find((r) => r.id === id)?.score
		return then && then !== now ? `${badge(then)} → ${badge(now)}` : badge(now)
	}
	const sections = Object.entries(pillars)
		.map(([pillar, title]) => {
			const rows = audit.rungs
				.filter((r) => r.pillar === pillar)
				.sort((a, b) => a.id - b.id)
				.map((rung) => {
					const paths = [
						...(rung.evidence ?? []).map((p) => `<code>${html(p)}</code>`),
						...(showChecked(rung)
							? rung.checked.map(
									(c) => `<span class="muted">checked: ${html(c)}</span>`,
								)
							: []),
					].join('<br>')
					return `<tr><td>${rung.id}</td><td>${html(rung.name)}${rung.inferred ? ' <em>(inferred)</em>' : ''}</td><td>${cell(rung.id)}</td><td>${paths}</td><td>${html(rung.notes)}</td></tr>`
				})
				.join('\n')
			return `<h2>${html(title)}</h2>\n<table><thead><tr><th>#</th><th>Rung</th><th>Score</th><th>Evidence</th><th>Notes</th></tr></thead><tbody>\n${rows}\n</tbody></table>`
		})
		.join('\n')
	const list = (items) =>
		`<ul>${items.map((item) => `<li>${html(item)}</li>`).join('')}</ul>`
	const verify = audit.verify.results.map(formatVerifyResult)
	const plan = planRows(audit)
	const questions = openQuestions(audit)
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autopilot audit: ${html(audit.repo.name)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#1b1f24}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}th,td{border:1px solid #d0d7de;padding:.4rem .6rem;text-align:left;vertical-align:top}
th{background:#f6f8fa}code{font-size:.85em;overflow-wrap:anywhere}td:nth-child(4){width:32%}.muted{color:#656d76;font-size:.85em}
.badge{display:inline-block;padding:0 .5rem;border-radius:1rem;font-size:.85em;font-weight:600}
.done{background:#dafbe1;color:#116329}.partial{background:#fff8c5;color:#7d4e00}.missing{background:#ffebe9;color:#a40e26}
.unknown{background:#eaeef2;color:#424a53}.na{background:#ddf4ff;color:#0a3069}
</style></head><body>
<h1>Autopilot audit: ${html(audit.repo.name)}${audit.repo.commit ? ` <code>${html(audit.repo.commit)}</code>` : ''}${before ? ' (before → after)' : ''}</h1>
<p><strong>Stack:</strong> ${html(audit.stack.summary)}</p>
<p><strong>Verify:</strong></p>${list(verify)}
<p>${scores.map((score) => `${badge(score)} ${counts[score]}`).join(' ')}</p>
${sections}
${audit.triage ? `<h2>Triage</h2><p>${html(triageLine(audit.triage))}</p>` : ''}
${audit.host?.facts?.length ? `<h2>Host facts (${html(audit.host.host)})</h2>${list(audit.host.facts.map((f) => `${f.rung ? `[rung ${f.rung}] ` : ''}${f.text} (${f.evidence})`))}` : ''}
${audit.findings?.length ? `<h2>Findings</h2>${list(audit.findings.map((f) => `${f.rung ? `[rung ${f.rung}] ` : ''}${f.text}`))}` : ''}
${questions.length ? `<h2>Open questions (no PR until answered)</h2>${list(questions)}` : ''}
${
	plan.length
		? `<h2>Plan</h2><table><thead><tr>${planHeader.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${plan
				.map(
					(row) =>
						`<tr>${Object.values(row)
							.map((v) => `<td>${html(v)}</td>`)
							.join('')}</tr>`,
				)
				.join('')}</tbody></table>`
		: ''
}
${audit.prs?.length ? `<h2>PRs</h2>${list(audit.prs.map((pr) => `rung ${pr.rung}: ${pr.status} ${pr.url}${pr.note ? ` (${pr.note})` : ''}`))}` : ''}
</body></html>
`
}

export function parseArgs(args) {
	const options = { file: null, html: null, before: null, json: false }
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--help' || arg === '-h') return { help: true }
		if (arg === '--json') options.json = true
		else if (arg === '--html' || arg === '--before') {
			const value = args[++i]
			if (!value) throw new Error(`${arg} requires a path`)
			options[arg.slice(2)] = value
		} else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`)
		else if (!options.file) options.file = arg
		else throw new Error(`Unexpected argument: ${arg}`)
	}
	if (!options.file) throw new Error(usage)
	return options
}

const usage = `Usage: kcd-skills autopilot report <audit.json> [--before before.json] [--html out.html] [--json]
Validates the audit (exit 1 with every problem), then prints the terminal report.
--html writes a self-contained HTML report too. --json prints {ok, errors, summary} only.`

export function main(
	args = process.argv.slice(2),
	io = {
		read: (f) => readFileSync(f, 'utf8'),
		write: writeFileSync,
		log: console.log,
	},
) {
	const options = parseArgs(args)
	if (options.help) {
		io.log(usage)
		return 0
	}
	const audit = parseAudit(io.read(options.file), options.file)
	const errors = validate(audit).map((e) => `${options.file}: ${e}`)
	let before
	if (options.before) {
		before = parseAudit(io.read(options.before), options.before)
		errors.push(...validate(before).map((e) => `${options.before}: ${e}`))
	}
	if (options.json) {
		io.log(
			JSON.stringify(
				{
					ok: errors.length === 0,
					errors,
					summary: errors.length ? null : summary(audit),
				},
				null,
				2,
			),
		)
		return errors.length ? 1 : 0
	}
	if (errors.length) {
		throw new Error(
			`Invalid audit (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n- ${errors.join('\n- ')}`,
		)
	}
	io.log(renderText(audit, before))
	if (options.html) {
		io.write(options.html, renderHtml(audit, before))
		io.log(`\nWrote ${options.html}`)
	}
	return 0
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
