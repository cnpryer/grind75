#!/usr/bin/env bun
/**
 * Read `[tool.ruff]` from the repo-root `pyproject.toml` and emit a
 * JSON blob consumable by the in-browser Ruff WASM Workspace so the host
 * `uv run ruff` and the Monaco editor's linter share one source of truth.
 *
 * Wired as `predev` / `prebuild` in `web/package.json`. Keep this script
 * dependency-free for the same reasons as `generate-problems-manifest.ts`.
 *
 * The parser is deliberately minimal: we don't need a full TOML — only the
 * three `[tool.ruff]` / `[tool.ruff.lint]` keys we actually forward to Ruff.
 * If the schema grows, either pull in a tiny TOML dep or hand-roll more.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const PYPROJECT = join(REPO_ROOT, 'pyproject.toml')
const OUT = join(REPO_ROOT, 'web', 'src', 'lib', 'ruff', 'generated-config.json')

interface RuffConfig {
	'line-length': number
	'target-version': string
	lint: { select: string[] }
}

class ParseError extends Error {}

function extractSection(toml: string, header: string): string | null {
	// Grab the body between `[header]` and the next top-level `[...]` or EOF.
	const re = new RegExp(`^\\[${header.replace(/\./g, '\\.')}\\]([\\s\\S]*?)(?=^\\[|\\Z)`, 'm')
	const m = toml.match(re)
	return m ? m[1] : null
}

function scalarString(section: string, key: string): string {
	const re = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`, 'm')
	const m = section.match(re)
	if (!m) throw new ParseError(`missing string key "${key}"`)
	return m[1]
}

function scalarInt(section: string, key: string): number {
	const re = new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*$`, 'm')
	const m = section.match(re)
	if (!m) throw new ParseError(`missing integer key "${key}"`)
	return Number.parseInt(m[1], 10)
}

function stringArray(section: string, key: string): string[] {
	const re = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]+)\\]\\s*$`, 'm')
	const m = section.match(re)
	if (!m) throw new ParseError(`missing array key "${key}"`)
	return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

async function main(): Promise<void> {
	const toml = await readFile(PYPROJECT, 'utf8')

	const ruff = extractSection(toml, 'tool.ruff')
	if (!ruff) throw new ParseError('missing [tool.ruff] section in pyproject.toml')
	const ruffLint = extractSection(toml, 'tool.ruff.lint')
	if (!ruffLint) throw new ParseError('missing [tool.ruff.lint] section in pyproject.toml')

	const config: RuffConfig = {
		'line-length': scalarInt(ruff, 'line-length'),
		'target-version': scalarString(ruff, 'target-version'),
		lint: { select: stringArray(ruffLint, 'select') },
	}

	await mkdir(dirname(OUT), { recursive: true })
	await writeFile(OUT, `${JSON.stringify(config, null, 2)}\n`)
	console.log(
		`[ruff-config] wrote line-length=${config['line-length']} target=${config['target-version']} select=${config.lint.select.join(',')}`,
	)
}

main().catch((err) => {
	console.error(`[ruff-config] ${err instanceof ParseError ? err.message : (err.stack ?? err)}`)
	process.exit(1)
})
