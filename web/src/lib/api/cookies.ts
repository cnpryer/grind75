import type { CookieSerializeOptions } from 'cookie'

/**
 * Token TTLs. The web container reads these from env so docker-compose can
 * pass the same values it gives the Rust API (see `docker-compose.yml`).
 * Fallbacks match PLAN.md defaults (15 min / 30 days).
 */
export const ACCESS_TOKEN_COOKIE = 'access_token'
export const REFRESH_TOKEN_COOKIE = 'refresh_token'

export function accessTtlSecs(env: Record<string, string | undefined>) {
	return Number(env.ACCESS_TOKEN_TTL_SECS ?? 900)
}

export function refreshTtlSecs(env: Record<string, string | undefined>) {
	return Number(env.REFRESH_TOKEN_TTL_SECS ?? 2_592_000)
}

/**
 * Cookie options for the access/refresh pair. `Secure` is set in all
 * environments — browsers allow it over `http://localhost` for dev.
 * `SameSite=Strict` is stricter than pryerdisposal's `Lax` because grind75
 * has no cross-site integration surface; cost is that external links land
 * logged-out, which is fine for a bookmarked personal tool.
 */
export function cookieOpts(maxAge: number): CookieSerializeOptions & { path: string } {
	return {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		maxAge,
	}
}
