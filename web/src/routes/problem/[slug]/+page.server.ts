import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'
import { ApiError } from '$lib/api/errors'
import { loadProblemSources } from '$lib/problems/loader'
import type { PageServerLoad } from './$types'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const load: PageServerLoad = async ({ params, fetch, locals }) => {
	const sources = await loadProblemSources(params.slug, fetch)
	const api = new ApiClient(API_URL, locals.accessToken)

	let progress = null
	try {
		progress = await api.getProgress(params.slug)
	} catch (err) {
		if (!(err instanceof ApiError) || err.status !== 404) {
			throw err
		}
	}

	// Fetch in parallel with the progress lookup above would be slightly faster,
	// but keeping this sequential keeps the 404 fall-through branch readable and
	// the page load is already dominated by the Pyodide bundle on the client.
	// Fall back to defaults if the settings endpoint is unreachable (network
	// error) or returns a non-OK response, so the problem view keeps loading
	// even when preferences are unavailable.
	let settings = { auto_start_timer: false }
	try {
		const fetched = await api.getSettings()
		settings = { auto_start_timer: fetched.auto_start_timer }
	} catch (err) {
		if (!(err instanceof ApiError) && !(err instanceof TypeError)) throw err
	}

	return {
		user: locals.user,
		problem: sources,
		progress,
		settings,
	}
}
