import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'
import type { PageServerLoad } from './$types'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const load: PageServerLoad = async ({ locals }) => {
	const api = new ApiClient(API_URL, locals.accessToken)
	const settings = await api.getSettings()

	return {
		user: locals.user,
		settings,
	}
}
