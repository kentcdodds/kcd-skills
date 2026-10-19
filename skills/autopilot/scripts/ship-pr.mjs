#!/usr/bin/env node
// Tick one PR through review, checks, approval, merge, and deploy verification.
// Order: merged→verify-deploy/done; closed→stop; draft→mark-ready; conflicts; behind;
// failing CI; pending CI; reviewer not configured→park; reviewer missing→wait;
// unresolved threads/changes requested→address-review; human approval→park;
// no merge authority→park; ready-to-merge / merge with --merge.
// Host-neutral: pass the PR state with --input (any host, any tool), or let
// the built-in GitHub adapter read it with `gh` when that is available.
// Exit codes: 0 done/parked, 10 needs agent action, 20 waiting,
// 30 needs PR state from the agent (--input), 1 error.
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const defaultConfig = {
	reviewers: { low: [], medium: [], high: [] },
	humanApprovalFor: ['high'],
	autoMergeFor: ['low'],
	mergeMethod: 'squash',
	deployCheck: null,
}

export function resolveConfig(config = {}) {
	const resolved = {
		...defaultConfig,
		...config,
		reviewers: { ...defaultConfig.reviewers, ...config.reviewers },
	}
	if (!['squash', 'merge', 'rebase'].includes(resolved.mergeMethod)) {
		throw new Error('mergeMethod must be squash, merge, or rebase')
	}
	if (
		resolved.deployCheck !== null &&
		(!Array.isArray(resolved.deployCheck) ||
			!resolved.deployCheck.length ||
			resolved.deployCheck.some((part) => typeof part !== 'string'))
	) {
		throw new Error(
			'deployCheck must be null or a non-empty argv array of strings',
		)
	}
	return resolved
}

export function parseConfig(text) {
	const withoutLineComments = text
		.split(/\r?\n/)
		.filter((line) => !/^\s*\/\//.test(line))
		.join('\n')
	return resolveConfig(JSON.parse(withoutLineComments))
}

function runGh(args, options = {}) {
	try {
		return execFileSync('gh', args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			...options,
		})
	} catch (error) {
		throw new Error(
			`gh ${args[0]} failed: ${error.stderr?.toString().trim() || error.message}`,
		)
	}
}

function parsePullRequest(input) {
	if (/^\d+$/.test(String(input))) {
		return { number: Number(input) }
	}
	let url
	try {
		url = new URL(input)
	} catch {
		throw new Error(`Expected a PR number or GitHub pull request URL: ${input}`)
	}
	const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/)
	if (url.hostname !== 'github.com' || !match) {
		throw new Error(`Expected a PR number or GitHub pull request URL: ${input}`)
	}
	return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

const stateQuery = `query ShipPrState($owner: String!, $name: String!, $number: Int!) {
 repository(owner: $owner, name: $name) { pullRequest(number: $number) {
  number url state isDraft mergeable mergeStateStatus headRefOid mergeCommit { oid } reviewDecision
  latestReviews(last: 50) { nodes { author { login } state } }
  reviewThreads(first: 100) { nodes { id isResolved isOutdated path line comments(first: 1) { nodes { author { login } body url } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes { __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }
 } }
}`

export function fetchState(input) {
	const target = parsePullRequest(input)
	if (!target.owner) {
		const repo = JSON.parse(runGh(['repo', 'view', '--json', 'owner,name']))
		target.owner = repo.owner?.login ?? repo.owner
		target.repo = repo.name
	}
	const result = JSON.parse(
		runGh([
			'api',
			'graphql',
			'-f',
			`query=${stateQuery}`,
			'-F',
			`owner=${target.owner}`,
			'-F',
			`name=${target.repo}`,
			'-F',
			`number=${target.number}`,
		]),
	)
	if (result.errors?.length) {
		throw new Error(result.errors.map((error) => error.message).join('; '))
	}
	if (!result.data?.repository?.pullRequest) {
		throw new Error(`Pull request #${target.number} was not found`)
	}
	return result
}

function reviewerLoginMatches(login, reviewer) {
	const normalize = (value) =>
		String(value ?? '')
			.replace(/\[bot\]$/i, '')
			.toLowerCase()
	return normalize(login) === normalize(reviewer)
}

function reviewerCheckMatches(name, reviewer) {
	return String(name ?? '').toLowerCase() === String(reviewer).toLowerCase()
}

export function normalize(graphqlJson, config = {}) {
	const pr =
		graphqlJson.data?.repository?.pullRequest ??
		graphqlJson.repository?.pullRequest ??
		graphqlJson.pullRequest ??
		graphqlJson
	if (!pr?.number) {
		throw new Error('GraphQL response does not contain a pull request')
	}
	const settings = resolveConfig(config)
	const reviewers = Object.values(settings.reviewers).flat()
	const reviews = (pr.latestReviews?.nodes ?? []).map((review) => ({
		login: review.author?.login ?? '',
		state: review.state,
	}))
	const rollup = pr.commits?.nodes?.at(-1)?.commit?.statusCheckRollup
	const checks = (rollup?.contexts?.nodes ?? []).map((check) => {
		if (check.__typename === 'CheckRun' || 'conclusion' in check) {
			let status = 'failure'
			if (check.status !== 'COMPLETED') {
				status = 'pending'
			} else if (check.conclusion === 'SUCCESS') {
				status = 'success'
			} else if (['NEUTRAL', 'SKIPPED'].includes(check.conclusion)) {
				status = 'neutral'
			}
			return { name: check.name, status, url: check.detailsUrl }
		}
		const contextState = String(check.state ?? '').toUpperCase()
		let status = 'failure'
		if (['PENDING', 'EXPECTED'].includes(contextState)) {
			status = 'pending'
		} else if (contextState === 'SUCCESS') {
			status = 'success'
		}
		return { name: check.context, status, url: check.targetUrl }
	})
	const unresolvedThreads = (pr.reviewThreads?.nodes ?? [])
		.filter((thread) => !thread.isResolved && !thread.isOutdated)
		.map((thread) => {
			const comment = thread.comments?.nodes?.[0] ?? {}
			return {
				id: thread.id,
				path: thread.path,
				line: thread.line,
				author: comment.author?.login ?? '',
				body: String(comment.body ?? '').slice(0, 300),
				url: comment.url,
			}
		})
	return {
		number: pr.number,
		url: pr.url,
		state: ['OPEN', 'MERGED', 'CLOSED'].includes(pr.state)
			? pr.state
			: 'CLOSED',
		draft: pr.isDraft,
		conflicts: pr.mergeable === 'CONFLICTING',
		behind: pr.mergeStateStatus === 'BEHIND',
		headSha: pr.headRefOid,
		mergeSha: pr.mergeCommit?.oid,
		reviewDecision: pr.reviewDecision,
		checks,
		reviews,
		approvedByHuman: reviews.some(
			(review) =>
				review.state === 'APPROVED' &&
				review.login &&
				!/\[bot\]$/i.test(review.login) &&
				!reviewers.some((reviewer) =>
					reviewerLoginMatches(review.login, reviewer),
				),
		),
		unresolvedThreads,
	}
}

export function decide(
	state,
	{ risk = 'medium', merge = false, config = {}, deployChecked = false } = {},
) {
	const settings = resolveConfig(config)
	const pr = state.url || String(state.number)
	if (state.state === 'MERGED') {
		if (settings.deployCheck && !deployChecked) {
			return {
				step: 'verify-deploy',
				reason: 'Run the configured deploy check.',
			}
		}
		return { step: 'done', reason: 'Pull request is merged.' }
	}
	if (state.state === 'CLOSED') {
		return { step: 'stop', reason: 'Pull request is closed without merging.' }
	}
	if (state.draft) {
		return {
			step: 'mark-ready',
			reason: 'Mark the draft pull request ready for review.',
			command: ['gh', 'pr', 'ready', pr],
		}
	}
	if (state.conflicts) {
		return {
			step: 'fix-conflicts',
			reason: 'Resolve merge conflicts before continuing.',
		}
	}
	if (state.behind) {
		return {
			step: 'update-branch',
			reason: 'Update the branch before continuing.',
			command: ['gh', 'pr', 'update-branch', pr],
		}
	}
	const failures = state.checks.filter((check) => check.status === 'failure')
	if (failures.length) {
		return { step: 'fix-ci', reason: 'Fix failing checks.', details: failures }
	}
	if (state.checks.some((check) => check.status === 'pending')) {
		return { step: 'wait', reason: 'Checks are still running.' }
	}
	const reviewers = settings.reviewers[risk] ?? []
	if (risk !== 'low' && reviewers.length === 0) {
		return {
			step: 'park',
			reason: `No reviewer configured for risk tier ${risk}. Add reviewers to the ship-pr config.`,
		}
	}
	const missing = reviewers.filter((reviewer) => {
		const reviewMatch = state.reviews.some((review) =>
			reviewerLoginMatches(review.login, reviewer),
		)
		const checkMatch = state.checks.some((check) =>
			reviewerCheckMatches(check.name, reviewer),
		)
		return !reviewMatch && !checkMatch
	})
	if (missing.length) {
		return {
			step: 'wait-for-review',
			reason: 'Required reviewer signal is missing.',
			details: missing,
		}
	}
	if (state.unresolvedThreads.length) {
		return {
			step: 'address-review',
			reason:
				'Fix each thread or reply with why it is invalid, then resolve it. Answer every unsure thread before resolving it.',
			details: state.unresolvedThreads,
		}
	}
	if (state.reviewDecision === 'CHANGES_REQUESTED') {
		return {
			step: 'address-review',
			reason: 'Address the requested changes and reply to the reviewer.',
		}
	}
	if (settings.humanApprovalFor.includes(risk) && !state.approvedByHuman) {
		return { step: 'park', reason: `Risk tier ${risk} needs human approval.` }
	}
	if (!settings.autoMergeFor.includes(risk) && !state.approvedByHuman) {
		return {
			step: 'park',
			reason: `Ready; agent has no merge authority for risk tier ${risk}. A human approves or merges.`,
		}
	}
	const command = [
		'gh',
		'pr',
		'merge',
		pr,
		`--${settings.mergeMethod}`,
		'--delete-branch',
	]
	if (!merge) {
		return {
			step: 'ready-to-merge',
			reason: 'All gates passed. Re-run with --merge to merge.',
			command,
		}
	}
	return {
		step: 'merge',
		reason: 'All configured merge gates passed.',
		command,
	}
}

function parseArgs(args) {
	if (args.includes('--help') || args.includes('-h')) {
		return { help: true }
	}
	if (args.includes('--schema')) {
		return { schema: true }
	}
	if (args[0] === 'resolve') {
		if (!args[1] || args.length !== 2) {
			throw new Error('Usage: kcd-skills autopilot ship-pr resolve <threadId>')
		}
		return { resolve: args[1] }
	}
	const options = {
		pr: null,
		input: null,
		risk: 'medium',
		merge: false,
		deployChecked: false,
		configPath: null,
		json: false,
		watch: false,
		interval: 60,
	}
	for (let i = 0; i < args.length; i++) {
		if (i === 0 && !args[i].startsWith('--')) {
			options.pr = args[i]
			continue
		}
		switch (args[i]) {
			case '--input':
				options.input = args[++i]
				if (!options.input) {
					throw new Error('--input requires a path, or - for stdin')
				}
				break
			case '--deploy-checked':
				options.deployChecked = true
				break
			case '--risk':
				options.risk = args[++i]
				if (!['low', 'medium', 'high'].includes(options.risk)) {
					throw new Error('--risk must be low, medium, or high')
				}
				break
			case '--merge':
				options.merge = true
				break
			case '--config':
				options.configPath = args[++i]
				if (!options.configPath) {
					throw new Error('--config requires a path')
				}
				break
			case '--json':
				options.json = true
				break
			case '--watch':
				options.watch = true
				if (args[i + 1] && !args[i + 1].startsWith('--')) {
					options.interval = Number(args[++i])
				}
				break
			case '--interval':
				options.interval = Number(args[++i])
				break
			default:
				throw new Error(`Unknown option: ${args[i]}`)
		}
	}
	if (!Number.isInteger(options.interval) || options.interval < 1) {
		throw new Error('--interval must be a positive integer')
	}
	if (!options.pr && !options.input) {
		throw new Error(usage)
	}
	if (options.input && options.watch) {
		throw new Error(
			'--watch needs the GitHub adapter; with --input, run again with fresh state',
		)
	}
	return options
}

export const configPaths = ['.github/ship-pr.json', 'ship-pr.json']

function loadConfig(file) {
	for (const candidate of file ? [file] : configPaths) {
		try {
			return parseConfig(readFileSync(candidate, 'utf8'))
		} catch (error) {
			if (error.code !== 'ENOENT') throw error
			if (file) throw new Error(`No such config file: ${file}`)
		}
	}
	return resolveConfig()
}

function report(decision, state, json) {
	const result = { ...decision, number: state.number, url: state.url }
	if (decision.step === 'done') {
		result.reminder =
			'File friction issues (one per durable papercut; search first) and post the summary.'
	}
	if (json) {
		console.log(JSON.stringify(result))
	} else {
		console.log(`PR #${state.number}: ${decision.step} — ${decision.reason}`)
		if (decision.details) {
			console.log(JSON.stringify(decision.details, null, 2))
		}
		if (result.reminder) {
			console.log(result.reminder)
		}
	}
}

const usage = `Usage: kcd-skills autopilot ship-pr --input <state.json|-> [--risk low|medium|high] [--merge] [--deploy-checked] [--config path] [--json]
       kcd-skills autopilot ship-pr <pr-number|url> [--risk ...] [--merge] [--config path] [--json] [--watch [--interval 60]]
       kcd-skills autopilot ship-pr resolve <threadId>
       kcd-skills autopilot ship-pr --schema
--input reads the PR state you gathered with your own tools (any host) and prints the next step.
Without --input, the built-in GitHub adapter reads the state with gh.
Config: --config, else .github/ship-pr.json, else ship-pr.json.`

export const stateSchema = `PR state for --input (JSON object). Gather it with whatever tools reach the code host.
{
  "number": 70,                       // PR or merge request number
  "url": "https://host/acme/app/pull/70",
  "state": "OPEN",                    // OPEN | MERGED | CLOSED
  "draft": false,
  "conflicts": false,                 // true when it cannot merge cleanly
  "behind": false,                    // true when the host requires updating from base first
  "headSha": "abc123",
  "mergeSha": null,                   // merge commit once merged
  "reviewDecision": null,             // CHANGES_REQUESTED when a reviewer asked for changes
  "checks": [{ "name": "ci", "status": "success", "url": "..." }],
                                      // status: success | failure | pending | neutral
  "reviews": [{ "login": "cursor[bot]", "state": "COMMENTED" }],
  "approvedByHuman": false,           // a person (not a configured AI reviewer) approved
  "unresolvedThreads": [{ "id": "t1", "path": "src/a.ts", "line": 3, "author": "cursor[bot]", "body": "...", "url": "..." }]
}
A GitHub GraphQL pullRequest response (the adapter's query) is accepted too.
Steps that change the PR (mark-ready, update-branch, merge) are returned for you to do with your tools; then run again with fresh state.`

const stateStatuses = ['OPEN', 'MERGED', 'CLOSED']
const checkStatuses = ['success', 'failure', 'pending', 'neutral']

// Accept either the normalized state above or a GitHub GraphQL response.
export function readState(input, config = {}) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error('PR state must be a JSON object (see --schema)')
	}
	const graphql =
		input.data?.repository ||
		input.repository ||
		input.pullRequest ||
		'isDraft' in input ||
		'latestReviews' in input
	if (graphql) return normalize(input, config)
	const errors = []
	if (!Number.isInteger(input.number) && typeof input.url !== 'string') {
		errors.push('number (integer) or url (string) is required')
	}
	if (!stateStatuses.includes(input.state)) {
		errors.push(`state must be one of ${stateStatuses.join(', ')}`)
	}
	for (const key of ['draft', 'conflicts', 'behind', 'approvedByHuman']) {
		if (input[key] !== undefined && typeof input[key] !== 'boolean') {
			errors.push(`${key} must be a boolean`)
		}
	}
	for (const key of ['checks', 'reviews', 'unresolvedThreads']) {
		if (input[key] !== undefined && !Array.isArray(input[key])) {
			errors.push(`${key} must be an array`)
		}
	}
	;(input.checks ?? []).forEach((check, index) => {
		if (typeof check?.name !== 'string') {
			errors.push(`checks[${index}].name must be a string`)
		}
		if (!checkStatuses.includes(check?.status)) {
			errors.push(
				`checks[${index}].status must be one of ${checkStatuses.join(', ')}`,
			)
		}
	})
	;(input.reviews ?? []).forEach((review, index) => {
		if (typeof review?.login !== 'string') {
			errors.push(`reviews[${index}].login must be a string`)
		}
	})
	if (errors.length) {
		throw new Error(
			`Invalid PR state (see --schema):\n- ${errors.join('\n- ')}`,
		)
	}
	return {
		number: input.number,
		url: input.url,
		state: input.state,
		draft: input.draft ?? false,
		conflicts: input.conflicts ?? false,
		behind: input.behind ?? false,
		headSha: input.headSha,
		mergeSha: input.mergeSha ?? undefined,
		reviewDecision: input.reviewDecision ?? null,
		checks: input.checks ?? [],
		reviews: input.reviews ?? [],
		approvedByHuman: input.approvedByHuman ?? false,
		unresolvedThreads: input.unresolvedThreads ?? [],
	}
}

const needsInput = (reason) =>
	`The built-in GitHub adapter is unavailable: ${reason}
Gather the PR state with your own tools and pass it in:
  kcd-skills autopilot ship-pr --input state.json   (or --input - to read stdin)
The format: kcd-skills autopilot ship-pr --schema`

// Returns null when gh can be used, else why not.
export function githubAdapterProblem(run = execFileSync) {
	try {
		run('gh', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
	} catch (error) {
		return error.code === 'ENOENT'
			? 'gh is not installed.'
			: `gh --version failed: ${error.message}`
	}
	try {
		run('gh', ['auth', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] })
	} catch {
		return 'gh is not authenticated (gh auth status failed).'
	}
	return null
}

function runDeployCheck(config, state) {
	try {
		execFileSync(config.deployCheck[0], config.deployCheck.slice(1), {
			env: { ...process.env, SHIP_PR_SHA: state.mergeSha ?? '' },
			stdio: 'inherit',
		})
		return {
			step: 'done',
			reason: 'Pull request is merged and deploy verification passed.',
		}
	} catch (error) {
		return {
			step: 'deploy-failed',
			reason: `Deploy check failed: ${error.message}`,
		}
	}
}

const hostActions = {
	'mark-ready': 'Mark the pull request ready for review',
	'update-branch': 'Update the branch from its base',
	merge: 'Merge the pull request',
}

export function exitCodeFor(step) {
	if (['wait', 'wait-for-review'].includes(step)) return 20
	if (
		[
			'fix-ci',
			'fix-conflicts',
			'address-review',
			'deploy-failed',
			...Object.keys(hostActions),
		].includes(step)
	) {
		return 10
	}
	return 0
}

function readInputFile(file) {
	return readFileSync(file === '-' ? 0 : file, 'utf8')
}

export function runWithInput(options, config, read = readInputFile) {
	let parsed
	try {
		parsed = JSON.parse(read(options.input))
	} catch (error) {
		throw new Error(`--input is not valid JSON: ${error.message}`)
	}
	const state = readState(parsed, config)
	let decision = decide(state, {
		risk: options.risk,
		merge: options.merge,
		config,
		deployChecked: options.deployChecked,
	})
	if (decision.step === 'verify-deploy') {
		decision = runDeployCheck(config, state)
	}
	const { command, ...rest } = decision
	if (hostActions[decision.step]) {
		const how = decision.step === 'merge' ? ` (${config.mergeMethod})` : ''
		rest.reason = `${decision.step === 'merge' ? 'All merge gates passed. ' : ''}${hostActions[decision.step]}${how} with your tools, then run again with fresh state.`
	}
	return { decision: rest, state }
}

export async function main(args = process.argv.slice(2)) {
	const options = parseArgs(args)
	if (options.help) {
		console.log(usage)
		return 0
	}
	if (options.schema) {
		console.log(stateSchema)
		return 0
	}
	if (options.input) {
		const config = loadConfig(options.configPath)
		const { decision, state } = runWithInput(options, config)
		report(decision, state, options.json)
		return exitCodeFor(decision.step)
	}
	const problem = githubAdapterProblem()
	if (problem) {
		if (options.resolve) {
			console.error(
				`Resolving needs the GitHub adapter, which is unavailable: ${problem}\nResolve the thread with your own tools.`,
			)
		} else {
			console.error(needsInput(problem))
		}
		return 30
	}
	if (options.resolve) {
		const query =
			'mutation ResolveReviewThread($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }'
		console.log(
			runGh([
				'api',
				'graphql',
				'-f',
				`query=${query}`,
				'-F',
				`threadId=${options.resolve}`,
			]).trim(),
		)
		return 0
	}
	const config = loadConfig(options.configPath)
	let deployChecked = false
	for (let tick = 0; tick < 60; tick++) {
		let raw
		try {
			raw = fetchState(options.pr)
		} catch (error) {
			console.error(needsInput(error.message))
			return 30
		}
		const state = normalize(raw, config)
		let decision = decide(state, {
			risk: options.risk,
			merge: options.merge,
			config,
			deployChecked,
		})
		if (decision.step === 'mark-ready' || decision.step === 'merge') {
			report(decision, state, options.json)
			runGh(decision.command.slice(1))
			continue
		}
		if (decision.step === 'verify-deploy') {
			decision = runDeployCheck(config, state)
			deployChecked = decision.step === 'done'
		}
		report(decision, state, options.json)
		if (decision.step === 'wait' || decision.step === 'wait-for-review') {
			if (options.watch && tick < 59) {
				await new Promise((resolve) =>
					setTimeout(resolve, options.interval * 1000),
				)
				continue
			}
			return 20
		}
		return exitCodeFor(decision.step)
	}
	return 20
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
	main().then(
		(code) => {
			process.exitCode = code
		},
		(error) => {
			console.error(error.message)
			process.exitCode = 1
		},
	)
}
