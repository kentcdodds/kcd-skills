// Small, validated edits to an autopilot audit JSON, so agents record
// judgments with one command instead of hand-editing JSON:
//   score <audit.json> <rung> <score> [--evidence x]... [--checked x]... [--note text] [--inferred]
//   finding <audit.json> "text" [--rung N]
//   plan-add <audit.json> <rung> --title text --file path... --effort S|M|L --door two-way|one-way
//   host <audit.json> --input facts.json|-   (facts the agent gathered from the code host)
//   host-request                              (prints what to gather and the format)
//   triage <audit.json> --input triage.json|-  (the team's priority scheme and decision marker)
//   triage-request                            (prints what to fill in and the format)
// Each edit writes the file, then prints the validator's problems for what it
// touched (exit 1 when there are any).
import { readFileSync, writeFileSync } from 'node:fs'
import { rungs, scores, validate } from './audit-report.mjs'

export const hostRequest = `Host facts for the audit. Gather them read-only with whatever reaches the code host
(its CLI, API, or web UI), then record them:
  kcd-skills autopilot host <audit.json> --input facts.json   (or --input - for stdin)

Format (JSON):
{
  "host": "github",                 // github | gitlab | bitbucket | gitea | other
  "facts": [
    {
      "rung": 7,                    // 1-13, the rung the fact informs (optional)
      "text": "AI reviewer cursor[bot] reviewed 9 of the last 10 merged PRs",
      "evidence": "gh pr list --state merged --limit 10 --json reviews"
                                    // the command or URL that shows it
    }
  ]
}

What to look for (skip what the host does not have; say so in a fact):
  1  branch protection or rulesets on the default branch: required checks and reviews
  6  who merges recent PRs, and whether they merged with failing or pending checks
  7  reviewers and AI-reviewer checks on recent PRs; release or deploy run history
  10 friction and friction-skipped labels; open friction issues
  11 how open issues are ranked and how decisions are flagged (record with kcd-skills autopilot triage)
  12 open Cleanup: issues and whether each has a "ready when"
  For each missing file the audit reports in a workflow: when that workflow last succeeded.`

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
	const errors = []
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return [
			'triage must be a JSON object (see kcd-skills autopilot triage request)',
		]
	}
	const systems = ['labels', 'project-field', 'tracker-field', 'none']
	if (!systems.includes(input.system)) {
		errors.push(`system must be one of ${systems.join(', ')}`)
	}
	if (
		!Array.isArray(input.priorities) ||
		input.priorities.length < 2 ||
		input.priorities.some((p) => typeof p !== 'string' || !p.trim())
	) {
		errors.push('priorities must list at least two values, highest first')
	}
	if (typeof input.decision !== 'string' || !input.decision.trim()) {
		errors.push(
			'decision must name the marker for issues that need a human call',
		)
	}
	if (typeof input.evidence !== 'string' || !input.evidence.trim()) {
		errors.push(
			'evidence must name the command, URL, or "interview" that shows it',
		)
	}
	if (input.existing !== undefined && typeof input.existing !== 'boolean') {
		errors.push('existing must be a boolean')
	}
	if (errors.length) return errors
	audit.triage = {
		system: input.system,
		...(input.tracker ? { tracker: String(input.tracker) } : {}),
		priorities: input.priorities,
		decision: input.decision,
		existing: input.existing ?? false,
		evidence: input.evidence,
	}
	return []
}

export const usage = `Usage: kcd-skills autopilot score <audit.json> <rung> <done|partial|missing|unknown|n/a> [--evidence path]... [--checked text]... [--note text] [--inferred]
       kcd-skills autopilot finding <audit.json> "text" [--rung N]
       kcd-skills autopilot plan add <audit.json> <rung> --title text --file path... --effort S|M|L --door two-way|one-way
       kcd-skills autopilot host request
       kcd-skills autopilot host <audit.json> --input facts.json|-
       kcd-skills autopilot triage request
       kcd-skills autopilot triage <audit.json> --input triage.json|-
Each edit writes the audit and prints any problems with what it changed (exit 1).`

const defaultIo = {
	read: (file) => readFileSync(file === '-' ? 0 : file, 'utf8'),
	write: writeFileSync,
	log: console.log,
	error: console.error,
}

export function main(command, args, io = defaultIo) {
	if (args.includes('--help') || args.includes('-h')) {
		io.log(usage)
		return 0
	}
	if (command === 'host-request') {
		io.log(hostRequest)
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
		if (!score || extra.length) throw new Error(usage)
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
		if (!text || extra.length) throw new Error(usage)
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
		if (!rung || extra.length) throw new Error(usage)
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
			io.error(`${usage}\n\n${hostRequest}`)
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
			io.error(`${usage}\n\n${triageRequest}`)
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
