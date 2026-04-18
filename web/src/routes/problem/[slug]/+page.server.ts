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

	return {
		user: locals.user,
		problem: sources,
		progress,
	}
}
