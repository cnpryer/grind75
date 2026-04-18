import { loadProblemSources } from '$lib/problems/loader'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch, locals }) => {
	const sources = await loadProblemSources(params.slug, fetch)
	return {
		user: locals.user,
		problem: sources,
	}
}
