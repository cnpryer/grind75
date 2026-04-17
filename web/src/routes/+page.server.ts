import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	// hooks.server.ts redirects unauthenticated requests to /login, so `user`
	// is guaranteed non-null by the time we reach this load.
	return { user: locals.user }
}
