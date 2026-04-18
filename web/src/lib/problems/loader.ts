import { error } from '@sveltejs/kit'

import { findProblem } from './manifest'
import type { ProblemSources } from './types'

/**
 * Fetch the markdown / starter / tests sources for `slug` from the same-origin
 * static tree. Intended for `+page.server.ts` — uses SvelteKit's `event.fetch`
 * so it hits the in-process request handler instead of going out over the
 * network during SSR.
 */
export async function loadProblemSources(
	slug: string,
	fetchFn: typeof fetch,
): Promise<ProblemSources> {
	const meta = findProblem(slug)
	if (!meta) {
		throw error(404, `Unknown problem slug: ${slug}`)
	}

	const base = `/problems/${slug}`
	const [markdown, starter, tests] = await Promise.all([
		fetchText(fetchFn, `${base}/problem.md`),
		fetchText(fetchFn, `${base}/starter.py`),
		fetchText(fetchFn, `${base}/tests.py`),
	])

	return { meta, markdown, starter, tests }
}

async function fetchText(fetchFn: typeof fetch, url: string): Promise<string> {
	const res = await fetchFn(url)
	if (!res.ok) {
		throw error(500, `Failed to load ${url}: ${res.status} ${res.statusText}`)
	}
	return await res.text()
}
