import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'
import { allProblems } from '$lib/problems/manifest'
import type { PageServerLoad } from './$types'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const load: PageServerLoad = async ({ locals }) => {
	const api = new ApiClient(API_URL, locals.accessToken)
	const progress = await api.listProgress()

	// hooks.server.ts redirects unauthenticated requests to /login, so `user`
	// is guaranteed non-null by the time we reach this load.
	return {
		user: locals.user,
		problems: allProblems(),
		progress,
	}
}
