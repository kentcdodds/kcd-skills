import assert from 'node:assert/strict'
import test from 'node:test'
import {
	decide,
	normalize,
	parseConfig,
} from '../skills/autopilot/scripts/ship-pr.mjs'

function fixture(overrides = {}) {
	return {
		number: 70,
		url: 'https://github.com/acme/app/pull/70',
		state: 'OPEN',
		isDraft: false,
		mergeable: 'MERGEABLE',
		mergeStateStatus: 'CLEAN',
		headRefOid: 'head-sha',
		mergeCommit: null,
		reviewDecision: 'APPROVED',
		latestReviews: { nodes: [] },
		reviewThreads: { nodes: [] },
		commits: {
			nodes: [
				{
					commit: {
						statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [] } },
					},
				},
			],
		},
		...overrides,
	}
}

function tick(overrides = {}, options = {}) {
	return decide(
		{
			number: 70,
			url: 'https://github.com/acme/app/pull/70',
			state: 'OPEN',
			draft: false,
			conflicts: false,
			behind: false,
			headSha: 'head-sha',
			mergeSha: undefined,
			reviewDecision: 'APPROVED',
			checks: [],
			reviews: [],
			approvedByHuman: false,
			unresolvedThreads: [],
			...overrides,
		},
		{ risk: 'low', ...options },
	)
}

test('parseConfig accepts full-line comments', () => {
	const parsed = parseConfig(`// Repo-wide policy
{
	// Require a named reviewer for medium risk
	"reviewers": { "medium": ["CodeRabbit"] }
}`)
	assert.deepEqual(parsed.reviewers, {
		low: [],
		medium: ['CodeRabbit'],
		high: [],
	})
})

test('normalize maps check runs, status contexts, threads, and human approvals', () => {
	const normalized = normalize(
		{
			data: {
				repository: {
					pullRequest: fixture({
						latestReviews: {
							nodes: [
								{ author: { login: 'review-bot[bot]' }, state: 'APPROVED' },
								{ author: { login: 'cursor-helper' }, state: 'APPROVED' },
								{ author: { login: 'kent' }, state: 'APPROVED' },
							],
						},
						reviewThreads: {
							nodes: [
								{
									id: 'thread-current',
									isResolved: false,
									isOutdated: false,
									path: 'src/index.js',
									line: 12,
									comments: {
										nodes: [
											{
												author: { login: 'reviewer' },
												body: 'Please update this.',
												url: 'https://example.test/comment',
											},
										],
									},
								},
								{
									id: 'thread-outdated',
									isResolved: false,
									isOutdated: true,
									comments: { nodes: [] },
								},
							],
						},
						commits: {
							nodes: [
								{
									commit: {
										statusCheckRollup: {
											contexts: {
												nodes: [
													{
														__typename: 'CheckRun',
														name: 'Running',
														status: 'IN_PROGRESS',
														conclusion: null,
														detailsUrl: 'https://example.test/pending',
													},
													{
														__typename: 'CheckRun',
														name: 'Good',
														status: 'COMPLETED',
														conclusion: 'SUCCESS',
														detailsUrl: 'https://example.test/good',
													},
													{
														__typename: 'CheckRun',
														name: 'Bad',
														status: 'COMPLETED',
														conclusion: 'FAILURE',
														detailsUrl: 'https://example.test/bad',
													},
													{
														__typename: 'CheckRun',
														name: 'Skipped',
														status: 'COMPLETED',
														conclusion: 'SKIPPED',
														detailsUrl: 'https://example.test/skipped',
													},
													{
														__typename: 'StatusContext',
														context: 'Legacy',
														state: 'EXPECTED',
														targetUrl: 'https://example.test/legacy',
													},
												],
											},
										},
									},
								},
							],
						},
					}),
				},
			},
		},
		{ reviewers: { low: ['cursor'] } },
	)
	assert.deepEqual(
		normalized.checks.map(({ name, status }) => [name, status]),
		[
			['Running', 'pending'],
			['Good', 'success'],
			['Bad', 'failure'],
			['Skipped', 'neutral'],
			['Legacy', 'pending'],
		],
	)
	assert.equal(normalized.approvedByHuman, true)
	assert.equal(normalized.unresolvedThreads.length, 1)
	assert.deepEqual(normalized.unresolvedThreads[0], {
		id: 'thread-current',
		path: 'src/index.js',
		line: 12,
		author: 'reviewer',
		body: 'Please update this.',
		url: 'https://example.test/comment',
	})
	assert.equal(
		normalize(
			fixture({
				latestReviews: {
					nodes: [{ author: { login: 'review-bot[bot]' }, state: 'APPROVED' }],
				},
			}),
		).approvedByHuman,
		false,
	)
	const normalizeApproval = (login, reviewer) =>
		normalize(
			fixture({
				latestReviews: { nodes: [{ author: { login }, state: 'APPROVED' }] },
			}),
			{ reviewers: { medium: [reviewer] } },
		).approvedByHuman
	assert.equal(normalizeApproval('cursor[bot]', 'cursor'), false)
	assert.equal(normalizeApproval('cursor-fan', 'cursor'), true)
	assert.equal(normalizeApproval('cursor', 'Cursor[bot]'), false)
})

test('decide returns done, verify-deploy, or stop for terminal PR states', () => {
	assert.equal(tick({ state: 'MERGED' }).step, 'done')
	assert.equal(
		tick(
			{ state: 'MERGED' },
			{ config: { deployCheck: ['curl', '-fsS', 'https://example.test'] } },
		).step,
		'verify-deploy',
	)
	assert.equal(tick({ state: 'CLOSED' }).step, 'stop')
})

test('decide marks drafts ready and prioritizes conflicts then behind branches', () => {
	const draft = tick({ draft: true })
	assert.equal(draft.step, 'mark-ready')
	assert.deepEqual(draft.command, [
		'gh',
		'pr',
		'ready',
		'https://github.com/acme/app/pull/70',
	])
	assert.deepEqual(tick({ draft: true, url: undefined }).command, [
		'gh',
		'pr',
		'ready',
		'70',
	])
	assert.equal(tick({ conflicts: true, behind: true }).step, 'fix-conflicts')
	assert.deepEqual(tick({ behind: true }).command, [
		'gh',
		'pr',
		'update-branch',
		'https://github.com/acme/app/pull/70',
	])
})

test('decide prioritizes failing and pending checks', () => {
	assert.equal(
		tick({ checks: [{ name: 'lint', status: 'failure', url: 'u' }] }).step,
		'fix-ci',
	)
	assert.equal(
		tick({ checks: [{ name: 'lint', status: 'pending', url: 'u' }] }).step,
		'wait',
	)
})

test('reviewer check names satisfy required reviewer signals', () => {
	const withoutSignal = tick(
		{},
		{
			risk: 'high',
			config: { reviewers: { high: ['cursor'] }, humanApprovalFor: ['high'] },
		},
	)
	assert.equal(withoutSignal.step, 'wait-for-review')
	const checkSignal = tick(
		{ checks: [{ name: 'Cursor', status: 'success' }] },
		{
			risk: 'high',
			config: { reviewers: { high: ['cursor'] }, humanApprovalFor: ['high'] },
		},
	)
	assert.equal(checkSignal.step, 'park')
	assert.match(checkSignal.reason, /human approval/)
})

test('reviewer logins match exactly with optional bot suffix and check names match exactly', () => {
	const decideWithReviewer = (reviewer, signal) =>
		tick(
			{ ...signal, approvedByHuman: true },
			{
				risk: 'medium',
				merge: true,
				config: {
					reviewers: { medium: [reviewer] },
					humanApprovalFor: [],
					autoMergeFor: ['medium'],
				},
			},
		)
	assert.equal(
		decideWithReviewer('cursor', { reviews: [{ login: 'cursor[bot]' }] }).step,
		'merge',
	)
	assert.equal(
		decideWithReviewer('cursor', { reviews: [{ login: 'cursor-fan' }] }).step,
		'wait-for-review',
	)
	assert.equal(
		decideWithReviewer('Cursor[bot]', { reviews: [{ login: 'cursor' }] }).step,
		'merge',
	)
	assert.equal(
		decideWithReviewer('coderabbit', {
			checks: [{ name: 'CodeRabbit', status: 'success' }],
		}).step,
		'merge',
	)
	assert.equal(
		decideWithReviewer('coderabbit', {
			checks: [{ name: 'CodeRabbit Review', status: 'success' }],
		}).step,
		'wait-for-review',
	)
})

test('unconfigured medium and high tiers park while low risk can proceed', () => {
	for (const risk of ['medium', 'high']) {
		const decision = tick({}, { risk })
		assert.equal(decision.step, 'park')
		assert.equal(
			decision.reason,
			`No reviewer configured for risk tier ${risk}. Add reviewers to the ship-pr config.`,
		)
	}
	assert.equal(tick({}).step, 'ready-to-merge')
})

test('decide addresses threads before requested changes and explains resolution', () => {
	const thread = {
		id: 'PRRT_kw',
		path: 'file.js',
		line: 1,
		author: 'reviewer',
		body: 'Fix it',
		url: 'u',
	}
	const decision = tick({
		unresolvedThreads: [thread],
		reviewDecision: 'CHANGES_REQUESTED',
	})
	assert.equal(decision.step, 'address-review')
	assert.deepEqual(decision.details, [thread])
	assert.match(
		decision.reason,
		/Answer every unsure thread before resolving it/,
	)
	assert.equal(
		tick({ reviewDecision: 'CHANGES_REQUESTED' }).step,
		'address-review',
	)
})

test('merge commands use the PR URL and merge authority never bypasses human approval', () => {
	const options = {
		risk: 'high',
		config: {
			reviewers: { high: ['cursor'] },
			humanApprovalFor: ['high'],
			autoMergeFor: [],
		},
	}
	const review = { reviews: [{ login: 'cursor' }] }
	assert.equal(tick(review, options).step, 'park')
	assert.equal(tick(review, { ...options, merge: true }).step, 'park')
	assert.equal(
		tick(
			{ reviews: [{ login: 'cursor' }] },
			{
				risk: 'medium',
				merge: true,
				config: {
					reviewers: { medium: ['cursor'] },
					humanApprovalFor: [],
					autoMergeFor: [],
				},
			},
		).step,
		'park',
	)
	assert.equal(
		tick(
			{ reviews: [{ login: 'cursor' }], approvedByHuman: true },
			{
				risk: 'medium',
				merge: true,
				config: {
					reviewers: { medium: ['cursor'] },
					humanApprovalFor: [],
					autoMergeFor: [],
				},
			},
		).step,
		'merge',
	)
})

test('auto-merge tiers require --merge and medium risk parks without human approval', () => {
	const low = { config: { reviewers: { low: [] }, autoMergeFor: ['low'] } }
	assert.equal(tick({}, low).step, 'ready-to-merge')
	assert.deepEqual(tick({}, { ...low, merge: true }).command, [
		'gh',
		'pr',
		'merge',
		'https://github.com/acme/app/pull/70',
		'--squash',
		'--delete-branch',
	])
	assert.equal(
		tick(
			{ reviews: [{ login: 'cursor' }] },
			{
				risk: 'medium',
				merge: true,
				config: {
					reviewers: { medium: ['cursor'] },
					humanApprovalFor: [],
					autoMergeFor: [],
				},
			},
		).step,
		'park',
	)
})
