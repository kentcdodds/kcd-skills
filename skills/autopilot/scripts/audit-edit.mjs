// Small, validated edits to an autopilot audit JSON, so agents record
// judgments with one command instead of hand-editing JSON:
//   score <audit.json> <rung> <score> [--evidence x]... [--checked x]... [--note text] [--inferred]
//   finding <audit.json> "text" [--rung N]
//   plan-add <audit.json> <rung> --title text --file path... --effort S|M|L --door two-way|one-way
//   host <audit.json> --input facts.json|-   (facts the agent gathered from the code host)
//   host-request                              (prints what to gather and the format)
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
      "rung": 7,                    // 1-12, the rung the fact informs (optional)
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
  11 open Cleanup: issues and whether each has a "ready when"
  For each missing file the audit reports in a workflow: when that workflow last succeeded.`

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
		throw new Error(`rung must be 1-12 (got ${value})`)
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
			errors.push(`facts[${index}].rung must be 1-12`)
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

export const usage = `Usage: kcd-skills autopilot score <audit.json> <rung> <done|partial|missing|unknown|n/a> [--evidence path]... [--checked text]... [--note text] [--inferred]
       kcd-skills autopilot finding <audit.json> "text" [--rung N]
       kcd-skills autopilot plan add <audit.json> <rung> --title text --file path... --effort S|M|L --door two-way|one-way
       kcd-skills autopilot host request
       kcd-skills autopilot host <audit.json> --input facts.json|-
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
