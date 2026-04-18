import { type Handle, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'
import {
	ACCESS_TOKEN_COOKIE,
	accessTtlSecs,
	cookieOpts,
	REFRESH_TOKEN_COOKIE,
	refreshTtlSecs,
} from '$lib/api/cookies'
import { decodeJwtPayload, isExpired } from '$lib/api/jwt'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

/** Paths that never require auth. */
const PUBLIC_PATHS = new Set(['/login', '/api/health', '/api/auth/logout'])

function isPublic(pathname: string) {
	if (PUBLIC_PATHS.has(pathname)) return true
	// SvelteKit assets, HMR, favicon, etc.
	if (pathname.startsWith('/_app/') || pathname.startsWith('/@')) return true
	if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true
	return false
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null
	event.locals.accessToken = null

	const accessToken = event.cookies.get(ACCESS_TOKEN_COOKIE)
	const refreshToken = event.cookies.get(REFRESH_TOKEN_COOKIE)

	if (accessToken) {
		const payload = decodeJwtPayload(accessToken)
		const canAttemptAccessValidation = payload && payload.typ === 'access' && !isExpired(payload)

		if (canAttemptAccessValidation) {
			try {
				const meResponse = await event.fetch(`${API_URL}/api/auth/me`, {
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
				})

				if (meResponse.ok) {
					event.locals.user = await meResponse.json()
					event.locals.accessToken = accessToken
				}
			} catch {
				// Treat validation failures as unauthenticated and fall through to
				// refresh handling below if a refresh token is present.
			}
		}
	}

	if (!event.locals.user && refreshToken) {
		// No valid access token (missing/expired/unverifiable) — try a refresh.
		try {
			const api = new ApiClient(API_URL)
			const tokens = await api.refresh({ refresh_token: refreshToken })
			event.cookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, {
				...cookieOpts(accessTtlSecs(env)),
			})
			event.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
				...cookieOpts(refreshTtlSecs(env)),
			})
			event.locals.user = tokens.user
			event.locals.accessToken = tokens.access_token
		} catch {
			// Refresh failed — token dead or API unreachable. Clear cookies so
			// the next cycle shows /login cleanly.
			event.cookies.delete(ACCESS_TOKEN_COOKIE, { path: '/' })
			event.cookies.delete(REFRESH_TOKEN_COOKIE, { path: '/' })
		}
	}

	const pathname = event.url.pathname
	if (!event.locals.user && !isPublic(pathname)) {
		const redirectTo = pathname + event.url.search
		throw redirect(303, `/login?redirect=${encodeURIComponent(redirectTo)}`)
	}

	const response = await resolve(event)

	// Authenticated and API routes must never be publicly cached.
	if (/^\/(api)(\/|$)/.test(pathname) || event.locals.user) {
		response.headers.set('Cache-Control', 'private, no-store')
	}

	return response
}