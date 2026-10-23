// Small, validated edits to an autopilot audit JSON, so agents record
// judgments with one command instead of hand-editing JSON:
//   score <audit.json> <rung> <score> [--evidence x]... [--checked x]... [--note text] [--inferred]
//   finding <audit.json> "text" [--rung N]
//   plan-add <audit.json> <rung> --title text [--file path]... --effort S|M|L --door two-way|one-way
//   host <audit.json> --input facts.json|-   (facts the agent gathered from the code host)
//   host-request                              (prints JSON to gather; guidance on stderr)
//   triage <audit.json> --input triage.json|-  (the team's priority scheme and decision marker)
//   triage-request                            (prints what to fill in and the format)
// Each edit writes the file, then prints the validator's problems for what it
// touched (exit 1 when there are any).
import { readFileSync, writeFileSync } from 'node:fs'
import { rungs, scores, validate, validateTriage } from './audit-report.mjs'

// Parseable sample for --input. Guidance lives in hostRequestGuide (stderr).
export const hostRequestSample = {
	host: 'github',
	facts: [
		{
			rung: 7,
			text: 'AI reviewer cursor[bot] reviewed 9 of the last 10 merged PRs',
			evidence: 'the host command or URL that shows this',
		},
	],
}

export const hostRequestGuide = `Host facts for the audit. Gather them read-only with whatever reaches the code host
(its CLI, API, or web UI), then record them:
  kcd-skills autopilot host <audit.json> --input facts.json   (or --input - for stdin)

Stdout is a JSON sample you can paste into --input (host: github | gitlab | bitbucket | gitea | other).
Each fact may include optional rung (1-13), text (what you found), and evidence (command or URL).

What to look for (skip what the host does not have; say so in a fact):
  1  branch protection or rulesets on the default branch: required checks and reviews
     (setup applies protection and reviews via the host API after the one setup PR
     merges, or right away when every plan row is settings-only and there is no
     setup PR; it adds required checks only after each has run on the default
     branch; record what exists today)
  6  who merges recent PRs, and whether they merged with failing or pending checks
  7  reviewers and AI-reviewer checks on recent PRs; release or deploy run history
  10 friction and friction-skipped labels; open friction issues
  11 how open issues are ranked and how decisions are flagged (record with kcd-skills autopilot triage)
  12 open Cleanup: issues and whether each has a "ready when"
  For each missing file the audit reports in a workflow: when that workflow last succeeded.
  Also note human-only gaps (secrets, app installs, access grants, org settings)
  for the setup checklist.`

// Back-compat alias: older callers may read hostRequest as the full text blob.
export const hostRequest = `${hostRequestGuide}

${JSON.stringify(hostRequestSample, null, 2)}`

export const triageRequest = `Triage setup for the audit: how the team ranks work and flags issues that need a human call.
Fill it from the interview answer and what the tracker shows, then record it:
  kcd-skills autopilot triage <audit.json> --input triage.json   (or --input - for stdin)

Format (JSON):
{
  "system": "labels",              // labels | project-field | tracker-field | none
  "tracker": "github",             // where issues live: github, gitlab, linear, jira, ...
  "priorities": ["P0", "P1", "P2", "P3"],
                                   // the team's priority values, highest first
  "decision": "needs-decision",    // the marker for an issue that waits for a human call
  "existing": false,               // true when the team already uses this scheme
  "evidence": "interview"          // the command, URL, or "interview" that shows it
}

Use the team's scheme when it has one: label names, a project-board field and its
options, or the tracker's priority field (for example Linear's Urgent, High, Medium, Low).
When it has none, use the default: P0-P3 labels plus a needs-decision label ("existing": false).
Rung 11 is done when every issue agents file gets a priority from this scheme and the
decision marker when it needs a human call.`

const readAudit = (file, read) => {
	try {
		return JSON.parse(read(file))
	} catch (error) {
		throw new Error(
			`${file}: ${error.code === 'ENOENT' ? 'no such file' : error.message}`,
		)
	}
}

function parseFlags(args, { multi = [], single = [], bool = [] }) {
	const flags = { _: [] }
	for (const name of multi) flags[name] = []
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (!arg.startsWith('--')) {
			flags._.push(arg)
			continue
		}
		const name = arg.slice(2)
		if (bool.includes(name)) flags[name] = true
		else if (multi.includes(name) || single.includes(name)) {
			const value = args[++i]
			if (value === undefined) throw new Error(`${arg} requires a value`)
			if (multi.includes(name)) flags[name].push(value)
			else flags[name] = value
		} else throw new Error(`Unknown option: ${arg}`)
	}
	return flags
}

const rungId = (value) => {
	const id = Number(value)
	if (!rungs.some((r) => r.id === id))
		throw new Error(`rung must be 1-13 (got ${value})`)
	return id
}

const unique = (items) => [...new Set(items)]

export function setScore(
	audit,
	id,
	score,
	{ evidence = [], checked = [], note, inferred } = {},
) {
	if (!scores.includes(score)) {
		throw new Error(`score must be one of ${scores.join(', ')} (got ${score})`)
	}
	const rung = audit.rungs?.find((r) => r.id === id)
	if (!rung)
		throw new Error(
			`rung ${id} is not in the audit; run kcd-skills autopilot audit first`,
		)
	rung.score = score
	rung.evidence = unique([...(rung.evidence ?? []), ...evidence])
	rung.checked = unique([...(rung.checked ?? []), ...checked])
	if (note !== undefined) rung.notes = note
	if (inferred !== undefined) rung.inferred = inferred
	return validate(audit).filter(
		(e) => e.startsWith(`rung ${id} `) || e.startsWith(`rung ${id}.`),
	)
}

export function addFinding(audit, text, rung) {
	audit.findings = audit.findings ?? []
	audit.findings.push(rung === undefined ? { text } : { text, rung })
	const index = audit.findings.length - 1
	return validate(audit).filter((e) => e.startsWith(`findings[${index}]`))
}

export function addPlanRow(audit, row) {
	const plan = (audit.plan ?? []).filter((r) => r.rung !== row.rung)
	plan.push(row)
	plan.sort((a, b) => a.rung - b.rung)
	audit.plan = plan
	const index = plan.indexOf(row)
	return validate(audit).filter((e) => e.startsWith(`plan[${index}]`))
}

export function addHostFacts(audit, input) {
	const errors = []
	if (!input || typeof input !== 'object' || !Array.isArray(input.facts)) {
		return [
			'host facts must be an object with a facts array (see kcd-skills autopilot host request)',
		]
	}
	if (typeof input.host !== 'string' || !input.host.trim())
		errors.push('host must name the code host')
	input.facts.forEach((fact, index) => {
		if (typeof fact?.text !== 'string' || !fact.text.trim())
			errors.push(`facts[${index}].text must be a non-empty string`)
		if (typeof fact?.evidence !== 'string' || !fact.evidence.trim())
			errors.push(
				`facts[${index}].evidence must name the command or URL that shows it`,
			)
		if (fact?.rung !== undefined && !rungs.some((r) => r.id === fact.rung))
			errors.push(`facts[${index}].rung must be 1-13`)
	})
	if (errors.length) return errors
	const previous =
		audit.host?.host === input.host ? (audit.host.facts ?? []) : []
	const key = (f) => `${f.rung ?? ''}|${f.text}`
	const seen = new Set(input.facts.map(key))
	audit.host = {
		host: input.host,
		facts: [
			...previous.filter((f) => !seen.has(key(f))),
			...input.facts.map((f) => ({
				...(f.rung ? { rung: f.rung } : {}),
				text: f.text,
				evidence: f.evidence,
			})),
		],
	}
	return []
}

export function setTriage(audit, input) {
	const errors = validateTriage(input)
	if (errors.length) return errors
	audit.triage = {
		system: input.system,
		...(input.tracker ? { tracker: input.tracker } : {}),
		priorities: input.priorities,
		decision: input.decision,
		existing: input.existing ?? false,
		evidence: input.evidence,
	}
	return []
}

export const usages = {
	score: `Usage: kcd-skills autopilot score <audit.json> <rung> <done|partial|missing|unknown|n/a> [--evidence path]... [--checked text]... [--note text] [--inferred]
Score one rung, write the audit, and print any problems with that rung (exit 1).`,
	finding: `Usage: kcd-skills autopilot finding <audit.json> "text" [--rung N]
Add a finding, write the audit, and print any problems with that finding (exit 1).`,
	'plan-add': `Usage: kcd-skills autopilot plan add <audit.json> <rung> --title text [--file path]... --effort S|M|L --door two-way|one-way
Add or replace a plan row for a rung (file rows ship in one setup PR; omit --file for settings-only). Writes the audit and prints any problems with that row (exit 1).`,
	host: `Usage: kcd-skills autopilot host <audit.json> --input facts.json|-
Record code-host facts you gathered. --input is JSON (see host request). Writes the audit (exit 1 on bad input).`,
	'host-request': `Usage: kcd-skills autopilot host request
Print a JSON sample on stdout (paste into host --input) and gathering guidance on stderr.`,
	triage: `Usage: kcd-skills autopilot triage <audit.json> --input triage.json|-
Record the team's priority scheme and decision marker. --input is JSON (see triage request). Writes the audit (exit 1 on bad input).`,
	'triage-request': `Usage: kcd-skills autopilot triage request
Print what to fill in for triage and the format.`,
}

// Combined string kept for error messages that do not know the command yet.
export const usage = Object.values(usages).join('\n')

const defaultIo = {
	read: (file) => readFileSync(file === '-' ? 0 : file, 'utf8'),
	write: writeFileSync,
	log: console.log,
	error: console.error,
}

export function main(command, args, io = defaultIo) {
	const commandUsage = usages[command] ?? usage
	if (args.includes('--help') || args.includes('-h')) {
		io.log(commandUsage)
		return 0
	}
	if (command === 'host-request') {
		io.error(hostRequestGuide)
		io.log(`${JSON.stringify(hostRequestSample, null, '\t')}\n`)
		return 0
	}
	if (command === 'triage-request') {
		io.log(triageRequest)
		return 0
	}
	let flags
	let file
	let audit
	let problems
	let done
	if (command === 'score') {
		flags = parseFlags(args, {
			multi: ['evidence', 'checked'],
			single: ['note'],
			bool: ['inferred'],
		})
		const [target, rung, score, ...extra] = flags._
		if (!score || extra.length) throw new Error(commandUsage)
		file = target
		audit = readAudit(file, io.read)
		const id = rungId(rung)
		problems = setScore(audit, id, score, {
			evidence: flags.evidence,
			checked: flags.checked,
			note: flags.note,
			inferred: flags.inferred,
		})
		done = `rung ${id}: ${score}`
	} else if (command === 'finding') {
		flags = parseFlags(args, { single: ['rung'] })
		const [target, text, ...extra] = flags._
		if (!text || extra.length) throw new Error(commandUsage)
		file = target
		audit = readAudit(file, io.read)
		problems = addFinding(
			audit,
			text,
			flags.rung === undefined ? undefined : rungId(flags.rung),
		)
		done = `finding added (${audit.findings.length} total)`
	} else if (command === 'plan-add') {
		flags = parseFlags(args, {
			multi: ['file'],
			single: ['title', 'effort', 'door'],
		})
		const [target, rung, ...extra] = flags._
		if (!rung || extra.length) throw new Error(commandUsage)
		file = target
		audit = readAudit(file, io.read)
		const id = rungId(rung)
		problems = addPlanRow(audit, {
			rung: id,
			title: flags.title,
			files: flags.file,
			effort: flags.effort,
			door: flags.door,
		})
		done = `plan row for rung ${id} (${audit.plan.length} rows)`
	} else if (command === 'host') {
		flags = parseFlags(args, { single: ['input'] })
		const [target, ...extra] = flags._
		if (!target || !flags.input || extra.length) {
			io.error(`${commandUsage}\n\n${hostRequestGuide}`)
			return 1
		}
		file = target
		audit = readAudit(file, io.read)
		let input
		try {
			input = JSON.parse(io.read(flags.input))
		} catch (error) {
			throw new Error(`--input is not valid JSON: ${error.message}`)
		}
		problems = addHostFacts(audit, input)
		if (problems.length) {
			io.error(`Host facts not recorded:\n- ${problems.join('\n- ')}`)
			return 1
		}
		done = `${audit.host.facts.length} host facts from ${audit.host.host}`
	} else if (command === 'triage') {
		flags = parseFlags(args, { single: ['input'] })
		const [target, ...extra] = flags._
		if (!target || !flags.input || extra.length) {
			io.error(`${commandUsage}\n\n${triageRequest}`)
			return 1
		}
		file = target
		audit = readAudit(file, io.read)
		let input
		try {
			input = JSON.parse(io.read(flags.input))
		} catch (error) {
			throw new Error(`--input is not valid JSON: ${error.message}`)
		}
		problems = setTriage(audit, input)
		if (problems.length) {
			io.error(`Triage not recorded:\n- ${problems.join('\n- ')}`)
			return 1
		}
		const t = audit.triage
		done = `triage ${t.system}: ${t.priorities.join(' > ')}; decision marker ${t.decision}`
	} else {
		throw new Error(usage)
	}
	io.write(file, `${JSON.stringify(audit, null, '\t')}\n`)
	io.log(`Wrote ${file}: ${done}`)
	if (problems.length) {
		io.error(`Fix before the report:\n- ${problems.join('\n- ')}`)
		return 1
	}
	return 0
}
