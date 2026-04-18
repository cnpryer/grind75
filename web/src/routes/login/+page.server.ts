import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'
import {
	ACCESS_TOKEN_COOKIE,
	accessTtlSecs,
	cookieOpts,
	REFRESH_TOKEN_COOKIE,
	refreshTtlSecs,
} from '$lib/api/cookies'
import { ApiError } from '$lib/api/errors'
import type { Actions, PageServerLoad } from './$types'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const load: PageServerLoad = async ({ locals, url }) => {
	// Already logged in — skip the form.
	if (locals.user) {
		const target = url.searchParams.get('redirect') || '/'
		throw redirect(303, target)
	}
	return { redirect: url.searchParams.get('redirect') ?? '/' }
}

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData()
		const username = String(form.get('username') ?? '').trim()
		const password = String(form.get('password') ?? '')

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required', username })
		}

		try {
			const api = new ApiClient(API_URL)
			const tokens = await api.login({ username, password })

			cookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, cookieOpts(accessTtlSecs(env)))
			cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, cookieOpts(refreshTtlSecs(env)))
		} catch (e) {
			if (e instanceof ApiError) {
				if (e.code === 'rate_limited') {
					return fail(429, { error: 'Too many attempts. Wait a minute and try again.', username })
				}
				return fail(401, { error: 'Invalid username or password', username })
			}
			return fail(500, { error: 'Login unavailable — try again in a moment', username })
		}

		const target = url.searchParams.get('redirect') || '/'
		throw redirect(303, target)
	},
}
