import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const skillsDir = path.join(import.meta.dirname, '..', 'skills')

function markdownFiles(dir) {
	return readdirSync(dir).flatMap((name) => {
		const full = path.join(dir, name)
		if (statSync(full).isDirectory()) return markdownFiles(full)
		return name.endsWith('.md') ? [full] : []
	})
}

test('skills contain no em dashes (use a period, comma, colon, or parentheses)', () => {
	const hits = []
	for (const file of markdownFiles(skillsDir)) {
		for (const [index, line] of readFileSync(file, 'utf8')
			.split('\n')
			.entries()) {
			if (line.includes('\u2014')) {
				hits.push(
					`${path.relative(skillsDir, file)}:${index + 1}: ${line.trim()}`,
				)
			}
		}
	}
	assert.deepEqual(hits, [], `Replace each em dash:\n${hits.join('\n')}`)
})
