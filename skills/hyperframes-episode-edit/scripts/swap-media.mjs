#!/usr/bin/env node
// PREVIEW-MIRROR ONLY. Rewrites media src attributes in a mirrored copy of this project
// to the temporary Dropbox URLs from review-media-temporary-links.json.
// Refuses to run unless a REVIEW_MIRROR marker file is present (never touches production).
// Usage:  node swap-media.mjs <mirror-dir> <review-media-temporary-links.json>
// MEDIA_MAP.json (in the mirror) maps each src to {dropbox_path, dropbox_content_hash, mirror_src?}.
// Never prints URLs.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '.')
if (!fs.existsSync(path.join(root, 'REVIEW_MIRROR'))) {
	console.error(
		'Refusing: REVIEW_MIRROR marker not found. Run this only in the mirrored review bundle.',
	)
	process.exit(2)
}
const linksFile = process.argv[3]
if (!linksFile) {
	console.error(
		'usage: node swap-media.mjs <mirror-dir> <review-media-temporary-links.json>',
	)
	process.exit(2)
}
const links = JSON.parse(fs.readFileSync(linksFile, 'utf8'))
const map = JSON.parse(
	fs.readFileSync(path.join(root, 'MEDIA_MAP.json'), 'utf8'),
)
const byDropbox = new Map(
	links
		.filter((e) => e?.result?.ok && e.result.body?.link)
		.map((e) => [e.path, e.result.body]),
)
const replacements = {}
for (const m of map.media) {
	if (m.mirror_src) {
		if (fs.existsSync(path.join(root, m.mirror_src))) {
			replacements[m.local_src] = m.mirror_src
			console.log(
				`${m.local_src} -> ${m.mirror_src} (browser-compatible H.264 review proxy)`,
			)
			continue
		}
		console.error(
			`WARNING: ${m.mirror_src} not found in mirror; falling back to the original via Dropbox link (HEVC: will render BLACK in browsers without HEVC). Copy the proxy into the mirror and re-run on a fresh extract.`,
		)
		process.exitCode = 1
	}
	if (!m.dropbox_path) continue
	const body = byDropbox.get(m.dropbox_path)
	if (!body) {
		console.error(`MISSING link for ${m.local_src}`)
		process.exitCode = 1
		continue
	}
	if (
		m.dropbox_content_hash &&
		body.metadata?.content_hash !== m.dropbox_content_hash
	) {
		console.error(`HASH MISMATCH for ${m.local_src}; skipping`)
		process.exitCode = 1
		continue
	}
	replacements[m.local_src] = body.link
}
const files = [
	'index.html',
	...fs
		.readdirSync(path.join(root, 'compositions'))
		.filter((f) => f.endsWith('.html'))
		.map((f) => `compositions/${f}`),
]
let total = 0
for (const rel of files) {
	const p = path.join(root, rel)
	let s = fs.readFileSync(p, 'utf8'),
		n = 0
	for (const [from, to] of Object.entries(replacements)) {
		const re = new RegExp(
			`src="${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
			'g',
		)
		s = s.replace(re, () => {
			n++
			return `src="${to.replace(/"/g, '&quot;')}"`
		})
	}
	if (n) {
		fs.writeFileSync(p, s)
		total += n
		console.log(`${rel}: ${n} src swapped`)
	}
}
const nProxy = Object.values(replacements).filter(
	(v) => !/^https?:/.test(v),
).length
console.log(
	`done: ${total} media src attributes swapped: ${Object.keys(replacements).length - nProxy} file(s) -> temporary Dropbox links (expire ~4h), ${nProxy} file(s) -> local H.264 review proxies.`,
)
