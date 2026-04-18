#!/usr/bin/env node
/**
 * Download and unpack the pinned Pyodide release into `web/static/pyodide/`.
 *
 * The version pin comes from `web/node_modules/pyodide/package.json` — a single
 * `npm install` updates both the type surface (`import type` from 'pyodide')
 * and the runtime bundle. Upgrading Pyodide is `npm i pyodide@<v>` followed
 * by `node scripts/stage-pyodide.mjs`.
 *
 * Skips re-download when the staged tree already matches the pinned version
 * (marker: `web/static/pyodide/.staged-version`). Force a re-stage with
 * `--force` or by deleting the marker.
 *
 * Why download the full release tarball instead of symlinking `node_modules`?
 * The npm package contains only the core runtime (`pyodide.asm.wasm`,
 * `python_stdlib.zip`, `pyodide-lock.json`) — the per-package wheels
 * (pytest, pluggy, iniconfig, …) live in the GitHub release tarball and are
 * fetched at runtime by `pyodide.loadPackage()` against `indexURL`.
 */

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const WEB_ROOT = join(REPO_ROOT, 'web')
const STAGE_DIR = join(WEB_ROOT, 'static', 'pyodide')
const MARKER = join(STAGE_DIR, '.staged-version')
const PKG_JSON = join(WEB_ROOT, 'node_modules', 'pyodide', 'package.json')

const force = process.argv.includes('--force')

/**
 * Packages we actually need at runtime. `loadPackage('pytest')` pulls deps
 * transitively via the lockfile, so we only seed the entry points — the
 * prune step resolves the closure and keeps only those wheels.
 */
const REQUIRED_PACKAGES = ['pytest']

/** Files that are part of the Pyodide runtime itself, not a loadable package. */
const CORE_FILES = new Set([
	'pyodide.asm.js',
	'pyodide.asm.wasm',
	'pyodide.d.ts',
	'pyodide.js',
	'pyodide.js.map',
	'pyodide.mjs',
	'pyodide.mjs.map',
	'pyodide-lock.json',
	'python_stdlib.zip',
	'package.json',
])

async function readStagedVersion() {
	try {
		return (await readFile(MARKER, 'utf8')).trim()
	} catch {
		return null
	}
}

async function readPinnedVersion() {
	try {
		const pkg = JSON.parse(await readFile(PKG_JSON, 'utf8'))
		if (!pkg.version) throw new Error(`${PKG_JSON} missing "version"`)
		return pkg.version
	} catch (err) {
		throw new Error(
			`Could not read Pyodide version from ${PKG_JSON}. Run \`npm install\` in web/ first. (${err.message})`,
		)
	}
}

async function exists(p) {
	try {
		await stat(p)
		return true
	} catch {
		return false
	}
}

async function download(url, dest) {
	const res = await fetch(url, { redirect: 'follow' })
	if (!res.ok || !res.body) {
		throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`)
	}
	const total = Number(res.headers.get('content-length') ?? 0)
	let seen = 0
	let lastPct = -1
	await new Promise((resolveStream, rejectStream) => {
		const out = createWriteStream(dest)
		out.on('error', rejectStream)
		out.on('finish', resolveStream)
		const reader = res.body.getReader()
		const pump = () =>
			reader
				.read()
				.then(({ done, value }) => {
					if (done) {
						out.end()
						return
					}
					seen += value.byteLength
					if (total > 0) {
						const pct = Math.floor((seen / total) * 20) * 5
						if (pct !== lastPct) {
							lastPct = pct
							process.stdout.write(`  … ${pct}%\r`)
						}
					}
					out.write(value, pump)
				})
				.catch(rejectStream)
		pump()
	})
	process.stdout.write('\n')
}

function extract(tarPath, destDir) {
	return new Promise((resolveChild, rejectChild) => {
		// `tar` handles .tar.bz2 transparently with `-j` on both GNU and BSD.
		const child = spawn('tar', ['-xjf', tarPath, '-C', destDir, '--strip-components=1'], {
			stdio: 'inherit',
		})
		child.on('error', rejectChild)
		child.on('exit', (code) =>
			code === 0 ? resolveChild() : rejectChild(new Error(`tar exited ${code}`)),
		)
	})
}

async function main() {
	const pinned = await readPinnedVersion()
	const staged = await readStagedVersion()

	if (!force && staged === pinned) {
		console.log(`[stage-pyodide] already staged (v${pinned}); skipping`)
		return
	}

	console.log(`[stage-pyodide] pinned v${pinned}${staged ? ` (was v${staged})` : ''}`)

	// Clean re-stage: remove the old directory entirely so stale wheels from
	// a previous version don't linger.
	if (await exists(STAGE_DIR)) {
		await rm(STAGE_DIR, { recursive: true, force: true })
	}
	await mkdir(STAGE_DIR, { recursive: true })

	const url = `https://github.com/pyodide/pyodide/releases/download/${pinned}/pyodide-${pinned}.tar.bz2`
	const tarPath = join(tmpdir(), `pyodide-${pinned}.tar.bz2`)

	console.log(`[stage-pyodide] downloading ${url}`)
	await download(url, tarPath)

	console.log(`[stage-pyodide] extracting to ${STAGE_DIR}`)
	await extract(tarPath, STAGE_DIR)

	await rm(tarPath, { force: true })

	console.log(`[stage-pyodide] pruning to ${REQUIRED_PACKAGES.join(', ')} + deps`)
	const kept = await prune()
	console.log(`[stage-pyodide] kept ${kept.keep} files, removed ${kept.removed}`)

	await writeFile(MARKER, `${pinned}\n`, 'utf8')
	console.log(`[stage-pyodide] done — v${pinned} at ${STAGE_DIR}`)
}

/**
 * The Pyodide release tarball ships wheels for every package in Pyodide's
 * registry (~1.2 GB: scipy, pandas, matplotlib, …). We only need pytest's
 * dep closure, so walk the lockfile, keep that set + the core runtime, and
 * delete the rest. adapter-node copies `static/` into the deploy output
 * unfiltered, so unstaged wheels become shipped bytes on `bun run build`.
 */
async function prune() {
	const lock = JSON.parse(await readFile(join(STAGE_DIR, 'pyodide-lock.json'), 'utf8'))
	const packages = lock.packages ?? {}

	const closure = new Set()
	const stack = [...REQUIRED_PACKAGES]
	while (stack.length) {
		const name = stack.pop()
		if (closure.has(name)) continue
		const entry = packages[name]
		if (!entry) throw new Error(`lockfile missing package: ${name}`)
		closure.add(name)
		for (const dep of entry.depends ?? []) stack.push(dep)
	}

	const keep = new Set(CORE_FILES)
	for (const name of closure) {
		const entry = packages[name]
		if (!entry?.file_name) continue
		keep.add(entry.file_name)
		keep.add(`${entry.file_name}.metadata`)
	}

	const entries = await readdir(STAGE_DIR)
	let removed = 0
	for (const name of entries) {
		if (keep.has(name)) continue
		await unlink(join(STAGE_DIR, name)).catch(async () => {
			// Directory entries (unlikely in Pyodide's flat dist, but handle it).
			await rm(join(STAGE_DIR, name), { recursive: true, force: true })
		})
		removed++
	}
	return { keep: entries.length - removed, removed }
}

main().catch((err) => {
	console.error(`[stage-pyodide] ${err.message}`)
	process.exit(1)
})
