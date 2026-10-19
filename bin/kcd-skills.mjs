#!/usr/bin/env node
// kcd-skills: print a skill's instructions (`kcd-skills <skill>`) or run one
// of its commands (`kcd-skills <skill> <command> ...`). Skills, references,
// and scripts ship in this package, so one version holds all of them.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const skillsDir = path.join(root, 'skills')
const { version } = JSON.parse(
	readFileSync(path.join(root, 'package.json'), 'utf8'),
)

// File URLs, so absolute Windows paths (C:\...) import too.
const script = (skill, name) =>
	import(
		pathToFileURL(path.join(skillsDir, skill, 'scripts', `${name}.mjs`)).href
	)

// Script-backed commands per skill. Each run returns an exit code.
export const commands = {
	autopilot: {
		audit: {
			summary: 'Prefill the audit JSON from the repo (local files and git)',
			run: async (args) =>
				(await script('autopilot', 'audit-detect')).main(args),
		},
		score: {
			summary: 'Score one rung with evidence, then validate it',
			run: async (args) =>
				(await script('autopilot', 'audit-edit')).main('score', args),
		},
		finding: {
			summary: 'Add a finding to the audit',
			run: async (args) =>
				(await script('autopilot', 'audit-edit')).main('finding', args),
		},
		host: {
			summary:
				'Record code-host facts you gathered (`host request` prints what to gather)',
			run: async (args) => {
				const edit = await script('autopilot', 'audit-edit')
				return args[0] === 'request'
					? edit.main('host-request', args.slice(1))
					: edit.main('host', args)
			},
		},
		triage: {
			summary:
				"Record the team's priority scheme and decision marker (`triage request` prints the format)",
			run: async (args) => {
				const edit = await script('autopilot', 'audit-edit')
				return args[0] === 'request'
					? edit.main('triage-request', args.slice(1))
					: edit.main('triage', args)
			},
		},
		plan: {
			summary: 'Add or replace a plan row: plan add <audit.json> <rung> ...',
			run: async (args) => {
				if (args[0] !== 'add' && !args.includes('--help')) {
					throw new Error(
						'Usage: kcd-skills autopilot plan add <audit.json> <rung> --title text --file path... --effort S|M|L --door two-way|one-way',
					)
				}
				return (await script('autopilot', 'audit-edit')).main(
					'plan-add',
					args.slice(args[0] === 'add' ? 1 : 0),
				)
			},
		},
		report: {
			summary: 'Validate the audit and print the report (--html, --before)',
			run: async (args) =>
				(await script('autopilot', 'audit-report')).main(args),
		},
		'ship-pr': {
			summary: 'Print the next step for a PR from its state (--input or gh)',
			run: async (args) => (await script('autopilot', 'ship-pr')).main(args),
		},
	},
}

export function listSkills() {
	return readdirSync(skillsDir, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				existsSync(path.join(skillsDir, entry.name, 'SKILL.md')),
		)
		.map((entry) => entry.name)
		.sort()
}

// References print as commands too: `kcd-skills autopilot templates`.
export function listReferences(skill) {
	const dir = path.join(skillsDir, skill, 'references')
	if (!existsSync(dir)) return []
	return readdirSync(dir)
		.filter((file) => file.endsWith('.md'))
		.map((file) => file.slice(0, -3))
		.filter((name) => !commands[skill]?.[name])
		.sort()
}

function describe(name) {
	const text = readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8')
	const match = text.match(/^description:\s*(?:>-?|\|)?\s*\n?([\s\S]*?)\n\S/m)
	const summary = (match?.[1] ?? '').replace(/\s+/g, ' ').trim()
	return summary.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? summary
}

function commandLines(skill) {
	const lines = []
	for (const [name, command] of Object.entries(commands[skill] ?? {})) {
		lines.push(`    ${skill} ${name.padEnd(13)} ${command.summary}`)
	}
	for (const name of listReferences(skill)) {
		lines.push(`    ${skill} ${name.padEnd(13)} Print references/${name}.md`)
	}
	return lines
}

export function help() {
	const lines = [
		`kcd-skills ${version}`,
		'',
		'Usage: npx kcd-skills@latest <skill>            print the skill instructions',
		'       npx kcd-skills@latest <skill> --help     list the skill commands',
		'       npx kcd-skills@latest <skill> <command>  run one of its commands (--help for options)',
		'',
		'Skills:',
	]
	for (const skill of listSkills()) {
		lines.push(`  ${skill}`)
		const summary = describe(skill)
		if (summary) lines.push(`    ${summary}`)
		lines.push(...commandLines(skill))
	}
	return lines.join('\n')
}

export function skillHelp(skill) {
	const lines = [
		`kcd-skills ${version} ${skill}`,
		describe(skill),
		'',
		`Usage: npx kcd-skills@latest ${skill}            print the skill instructions`,
	]
	const commandList = commandLines(skill)
	if (commandList.length) {
		lines.push(
			`       npx kcd-skills@latest ${skill} <command>  run a command (add --help for its options)`,
			'',
			'Commands:',
			...commandList,
		)
	}
	return lines.filter((line, i) => line || i !== 1).join('\n')
}

export async function run(
	args,
	io = { log: console.log, write: (text) => process.stdout.write(text) },
) {
	const [skill, command, ...rest] = args
	if (!skill || skill === '--help' || skill === '-h' || skill === 'help') {
		io.log(help())
		return 0
	}
	if (skill === '--version' || skill === '-v') {
		io.log(version)
		return 0
	}
	if (!listSkills().includes(skill)) {
		throw new Error(
			`Unknown skill: ${skill}. Skills: ${listSkills().join(', ')}. Run kcd-skills --help.`,
		)
	}
	if (['--help', '-h', 'help'].includes(command)) {
		io.log(skillHelp(skill))
		return 0
	}
	if (!command) {
		const text = readFileSync(path.join(skillsDir, skill, 'SKILL.md'), 'utf8')
		io.write(`<!-- kcd-skills@${version} ${skill} -->\n${text}`)
		return 0
	}
	const entry = commands[skill]?.[command]
	if (entry) return (await entry.run(rest)) ?? 0
	if (listReferences(skill).includes(command)) {
		io.write(
			readFileSync(
				path.join(skillsDir, skill, 'references', `${command}.md`),
				'utf8',
			),
		)
		return 0
	}
	const available = [
		...Object.keys(commands[skill] ?? {}),
		...listReferences(skill),
	]
	throw new Error(
		`Unknown command: ${skill} ${command}.${available.length ? ` ${skill} commands: ${available.join(', ')}.` : ` ${skill} has no commands; run kcd-skills ${skill} for its instructions.`}`,
	)
}

// Real paths: npx runs this through a node_modules/.bin symlink.
function isMain() {
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
		process.exitCode = await run(process.argv.slice(2))
	} catch (error) {
		console.error(error.message)
		process.exitCode = 1
	}
}
