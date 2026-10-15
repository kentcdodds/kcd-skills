import assert from 'node:assert/strict'
import test from 'node:test'
import {
	classifyPaths,
	parsePrimitivesMap,
	pathMatchesRoot,
} from '../skills/visual-recap/scripts/primitives-map.mjs'
import {
	isGhPrEditForbidden,
	mergeRecapBody,
} from '../skills/visual-recap/scripts/upsert-recap-block.mjs'

test('parsePrimitivesMap reads taxonomy fields and oxfmt-folded summaries', () => {
	const map = parsePrimitivesMap(`
version: 1
groups:
  - id: auth
    name: Identity & auth
primitives:
  - id: app-sessions
    group: auth
    name: Browser sessions
    summary: Cookie sessions and signup.
    code:
      - packages/worker/src/app/handlers/auth.ts
    docs:
      - docs/contributing/architecture/authentication.md
  - id: folded
    group: auth
    name: Folded
    summary:
      Folded onto the next indented line.
invariants:
  - id: per-user-isolation
    summary: userId scopes every path.
`)
	assert.equal(map.version, 1)
	assert.deepEqual(map.groups, [{ id: 'auth', name: 'Identity & auth' }])
	assert.equal(map.primitives.length, 2)
	assert.deepEqual(
		{
			id: map.primitives[0].id,
			group: map.primitives[0].group,
			name: map.primitives[0].name,
			summary: map.primitives[0].summary,
			code: map.primitives[0].code,
			docs: map.primitives[0].docs,
		},
		{
			id: 'app-sessions',
			group: 'auth',
			name: 'Browser sessions',
			summary: 'Cookie sessions and signup.',
			code: ['packages/worker/src/app/handlers/auth.ts'],
			docs: ['docs/contributing/architecture/authentication.md'],
		},
	)
	assert.equal(
		map.primitives[1]?.summary,
		'Folded onto the next indented line.',
	)
	assert.equal(map.invariants[0]?.id, 'per-user-isolation')
})

test('classifyPaths longest-prefix match respects directory and prefix roots', () => {
	const roots = [
		[
			'packages/worker/src/app/handlers/auth.ts',
			'packages/worker/src/app/',
			true,
		],
		['packages/worker/src/apple.ts', 'packages/worker/src/app/', false],
		[
			'packages/worker/src/app/oauth-providers.ts',
			'packages/worker/src/app/oauth-',
			true,
		],
		['packages/worker/src/mcp-auth.ts', 'packages/worker/src/mcp/', false],
	]
	assert.deepEqual(
		roots.map(([path, root]) => pathMatchesRoot(path, root)),
		roots.map(([, , matches]) => matches),
	)

	const map = parsePrimitivesMap(`
version: 1
groups:
  - id: surfaces
    name: Entry points
  - id: assistant
    name: Assistant
primitives:
  - id: mcp-server
    group: surfaces
    name: MCP endpoint
    summary: MCP server.
    code:
      - packages/worker/src/mcp/
  - id: saved-packages
    group: assistant
    name: Saved packages
    summary: Packages.
    code:
      - packages/worker/src/mcp/capabilities/packages/
`)
	const { matched, unmatched } = classifyPaths(
		[
			'packages/worker/src/mcp/capabilities/packages/save.ts',
			'packages/worker/src/mcp/index.ts',
			'README.md',
		],
		map,
	)
	assert.deepEqual(unmatched, ['README.md'])
	assert.deepEqual(matched.map((entry) => entry.primitive.id).sort(), [
		'mcp-server',
		'saved-packages',
	])
	assert.deepEqual(
		matched.find((entry) => entry.primitive.id === 'saved-packages')?.files,
		['packages/worker/src/mcp/capabilities/packages/save.ts'],
	)
})

test('mergeRecapBody replaces an existing block without touching surrounding text', () => {
	const start = '<!-- system-recap:start -->'
	const end = '<!-- system-recap:end -->'
	const oldBlock = `${start}\nold\n${end}`
	const newBlock = `${start}\nnew\n${end}`
	const body = `Intro\n\n${oldBlock}\n\nOutro\n`
	const { hasExistingBlock, nextBody } = mergeRecapBody(body, newBlock)
	assert.equal(hasExistingBlock, true)
	assert.equal(nextBody, `Intro\n\n${newBlock}\n\nOutro\n`)
})

test('mergeRecapBody appends when no block exists', () => {
	const block = '<!-- system-recap:start -->\nblock\n<!-- system-recap:end -->'
	const { hasExistingBlock, nextBody } = mergeRecapBody('Hello', block)
	assert.equal(hasExistingBlock, false)
	assert.equal(nextBody, `Hello\n\n${block}\n`)
})

test('isGhPrEditForbidden detects integration updatePullRequest failures', () => {
	assert.equal(
		isGhPrEditForbidden(
			new Error('GraphQL: Resource not accessible by integration'),
		),
		true,
	)
	assert.equal(isGhPrEditForbidden(new Error('updatePullRequest denied')), true)
	assert.equal(isGhPrEditForbidden(new Error('network timeout')), false)
})
