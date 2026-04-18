#!/usr/bin/env bun
/**
 * Walk `problems/<slug>/` dirs, validate each `meta.json`, copy source files
 * into `web/static/problems/<slug>/`, and emit a typed manifest at
 * `web/src/lib/problems/generated-manifest.json`.
 *
 * Wired as `predev` / `prebuild` in `web/package.json`. Keep this script
 * dependency-free: it runs before `bun install` finishes resolving the web
 * tree in some CI modes, so importing anything under `web/node_modules` is
 * a bad idea.
 */

import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const PROBLEMS_DIR = join(REPO_ROOT, 'problems')
const WEB_STATIC_DIR = join(REPO_ROOT, 'web', 'static', 'problems')
const MANIFEST_OUT = join(
	REPO_ROOT,
	'web',
	'src',
	'lib',
	'problems',
	'generated-manifest.json',
)

const DIFFICULTIES = new Set(['easy', 'medium', 'hard'])
const PATTERNS = new Set([
	'array',
	'hashmap',
	'two-pointer',
	'stack',
	'linked-list',
	'tree',
	'binary-search',
	'graph',
	'sliding-window',
])
const SLUG_RE = /^[a-z0-9-]+$/
const PY_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

interface ProblemMeta {
	schema_version: 1
	id: number
	slug: string
	title: string
	difficulty: 'easy' | 'medium' | 'hard'
	pattern: string
	leetcode_url: string
	recommended_minutes: number
	execution_timeout_seconds: number
	tags: string[]
	order: number
	entry_function: string
}

class ValidationError extends Error {}

function requireField<T>(obj: Record<string, unknown>, key: string, guard: (v: unknown) => v is T, ctx: string): T {
	const v = obj[key]
	if (!guard(v)) {
		throw new ValidationError(`${ctx}: field "${key}" failed validation (got ${JSON.stringify(v)})`)
	}
	return v
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

function parseMeta(raw: unknown, slugOnDisk: string, source: string): ProblemMeta {
	if (typeof raw !== 'object' || raw === null) {
		throw new ValidationError(`${source}: expected JSON object`)
	}
	const obj = raw as Record<string, unknown>

	if (obj.schema_version !== 1) {
		throw new ValidationError(`${source}: schema_version must be 1, got ${obj.schema_version}`)
	}

	const id = requireField(obj, 'id', isPosInt, source)
	const slug = requireField(obj, 'slug', isString, source)
	if (!SLUG_RE.test(slug)) {
		throw new ValidationError(`${source}: slug "${slug}" must match ${SLUG_RE}`)
	}
	if (slug !== slugOnDisk) {
		throw new ValidationError(
			`${source}: slug "${slug}" does not match containing directory "${slugOnDisk}"`,
		)
	}

	const title = requireField(obj, 'title', isString, source)

	const difficulty = obj.difficulty
	if (typeof difficulty !== 'string' || !DIFFICULTIES.has(difficulty)) {
		throw new ValidationError(
			`${source}: difficulty must be one of ${[...DIFFICULTIES].join(', ')}, got ${JSON.stringify(difficulty)}`,
		)
	}

	const pattern = obj.pattern
	if (typeof pattern !== 'string' || !PATTERNS.has(pattern)) {
		throw new ValidationError(
			`${source}: pattern must be one of ${[...PATTERNS].join(', ')}, got ${JSON.stringify(pattern)}`,
		)
	}

	const leetcode_url = requireField(obj, 'leetcode_url', isString, source)
	if (!leetcode_url.startsWith('https://leetcode.com/')) {
		throw new ValidationError(`${source}: leetcode_url must begin with https://leetcode.com/`)
	}

	const recommended_minutes = requireField(obj, 'recommended_minutes', isPosInt, source)
	const execution_timeout_seconds = requireField(obj, 'execution_timeout_seconds', isPosInt, source)

	const tagsRaw = obj.tags
	if (!Array.isArray(tagsRaw) || !tagsRaw.every(isString)) {
		throw new ValidationError(`${source}: tags must be a non-empty array of strings`)
	}
	const tags = tagsRaw as string[]

	const order = requireField(obj, 'order', isPosInt, source)

	const entry_function = requireField(obj, 'entry_function', isString, source)
	if (!PY_IDENT_RE.test(entry_function)) {
		throw new ValidationError(
			`${source}: entry_function "${entry_function}" is not a valid Python identifier`,
		)
	}

	return {
		schema_version: 1,
		id,
		slug,
		title,
		difficulty: difficulty as ProblemMeta['difficulty'],
		pattern,
		leetcode_url,
		recommended_minutes,
		execution_timeout_seconds,
		tags,
		order,
		entry_function,
	}
}

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p)
		return true
	} catch {
		return false
	}
}

const SOURCE_FILES = ['problem.md', 'starter.py', 'tests.py'] as const

async function main(): Promise<void> {
	if (!(await exists(PROBLEMS_DIR))) {
		console.log(`[manifest] no problems/ dir yet — emitting empty manifest`)
		await writeFile(MANIFEST_OUT, `${JSON.stringify({ problems: [] }, null, 2)}\n`)
		return
	}

	const entries = await readdir(PROBLEMS_DIR, { withFileTypes: true })
	const slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
	const metas: ProblemMeta[] = []

	for (const slug of slugs) {
		const dir = join(PROBLEMS_DIR, slug)
		const metaPath = join(dir, 'meta.json')
		if (!(await exists(metaPath))) {
			throw new ValidationError(`problems/${slug}: missing meta.json`)
		}
		for (const src of SOURCE_FILES) {
			if (!(await exists(join(dir, src)))) {
				throw new ValidationError(`problems/${slug}: missing ${src}`)
			}
		}
		const raw = JSON.parse(await readFile(metaPath, 'utf8'))
		const meta = parseMeta(raw, slug, `problems/${slug}/meta.json`)
		metas.push(meta)
	}

	// Sort by `order` for stable consumption (dashboard renders in manifest order).
	metas.sort((a, b) => a.order - b.order || a.id - b.id)

	// Cross-check: ids and orders must be unique.
	assertUnique(metas.map((m) => m.id), 'id')
	assertUnique(metas.map((m) => m.order), 'order')

	// Stage source files into the web static tree so +page.server.ts can fetch
	// them via event.fetch('/problems/<slug>/...').
	await rm(WEB_STATIC_DIR, { recursive: true, force: true })
	await mkdir(WEB_STATIC_DIR, { recursive: true })
	for (const meta of metas) {
		const destDir = join(WEB_STATIC_DIR, meta.slug)
		await mkdir(destDir, { recursive: true })
		for (const src of SOURCE_FILES) {
			await copyFile(join(PROBLEMS_DIR, meta.slug, src), join(destDir, src))
		}
	}

	await mkdir(dirname(MANIFEST_OUT), { recursive: true })
	await writeFile(MANIFEST_OUT, `${JSON.stringify({ problems: metas }, null, 2)}\n`)

	console.log(
		`[manifest] wrote ${metas.length} problem${metas.length === 1 ? '' : 's'}: ${metas.map((m) => m.slug).join(', ')}`,
	)
}

function assertUnique(values: number[], field: string): void {
	const seen = new Map<number, number>()
	for (const v of values) {
		seen.set(v, (seen.get(v) ?? 0) + 1)
	}
	const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([v]) => v)
	if (dupes.length > 0) {
		throw new ValidationError(`duplicate ${field}: ${dupes.join(', ')}`)
	}
}

main().catch((err) => {
	if (err instanceof ValidationError) {
		console.error(`[manifest] ${err.message}`)
	} else {
		console.error(`[manifest] ${err.stack ?? err.message ?? err}`)
	}
	process.exit(1)
})
