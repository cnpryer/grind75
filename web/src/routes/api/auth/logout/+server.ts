import { json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '$lib/api/cookies'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const POST: RequestHandler = async ({ cookies, locals }) => {
	const refreshToken = cookies.get(REFRESH_TOKEN_COOKIE)

	// Best-effort revoke on the API. Even if it fails (e.g., API down), we still
	// clear cookies locally so the user is logged out from this device.
	if (refreshToken && locals.accessToken) {
		try {
			const api = new ApiClient(API_URL, locals.accessToken)
			await api.logout({ refresh_token: refreshToken })
		} catch {
			// Ignore — cookie clear below is the actual logout.
		}
	}

	cookies.delete(ACCESS_TOKEN_COOKIE, { path: '/' })
	cookies.delete(REFRESH_TOKEN_COOKIE, { path: '/' })

	return json({ ok: true })
}
