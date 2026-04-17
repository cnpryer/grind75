/**
 * JWT payload decode — **no signature verification**. The Rust API is the
 * signing authority; `hooks.server.ts` only needs the payload for two
 * things: (1) expiry check to decide whether to refresh, (2) `sub` claim to
 * populate `locals.user.username`. Any tampered token will be rejected by
 * the API on the next real call.
 */
export interface JwtPayload {
	sub: string
	jti: string
	typ: 'access' | 'refresh'
	exp: number
	iat: number
}

export function decodeJwtPayload(token: string): JwtPayload | null {
	const parts = token.split('.')
	if (parts.length !== 3) return null
	try {
		// Base64URL → base64 padding
		const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
		const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
		const json = atob(padded)
		return JSON.parse(json) as JwtPayload
	} catch {
		return null
	}
}

/** True if the token is past expiry (or within 30s of it — refresh early). */
export function isExpired(payload: JwtPayload, skewSecs = 30): boolean {
	const now = Math.floor(Date.now() / 1000)
	return payload.exp - skewSecs <= now
}
