import { fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'
import { ApiError } from '$lib/api/errors'
import type { Actions, PageServerLoad } from './$types'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const load: PageServerLoad = async ({ locals }) => {
	const api = new ApiClient(API_URL, locals.accessToken)
	const settings = await api.getSettings()

	return {
		user: locals.user,
		settings,
	}
}

export const actions: Actions = {
	updateSettings: async ({ request, locals }) => {
		const api = new ApiClient(API_URL, locals.accessToken)
		const formData = await request.formData()
		// use:enhance normalises the checkbox to an explicit "true"/"false" string
		// before submission, so we can parse it unambiguously here.
		const autoStartTimer = formData.get('auto_start_timer') === 'true'
		try {
			const updated = await api.updateSettings({ auto_start_timer: autoStartTimer })
			return { settings: updated }
		} catch (error) {
			if (error instanceof ApiError) {
				return fail(error.status, { error: error.message })
			}
			return fail(500, { error: 'Failed to save settings' })
		}
	},
}
