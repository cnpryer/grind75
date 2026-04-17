/**
 * API error envelope. The Rust API emits a flat `{error, message}` shape
 * (see `api/src/error.rs`). `ApiError.code` is one of the typed strings
 * from `AuthErrorCode` (plus `not_found`, `validation_error`, `conflict`,
 * `bad_request`, `not_implemented`, `internal_error`) — branch on `code`,
 * never on `message`.
 */
export class ApiError extends Error {
	status: number
	code: string

	constructor(status: number, body: { error?: string; message?: string }) {
		super(body?.message || 'An error occurred')
		this.status = status
		this.code = body?.error || 'unknown_error'
	}

	/** Access token is past expiry — hooks.server.ts should attempt a refresh. */
	get isTokenExpired() {
		return this.code === 'token_expired'
	}

	/** Refresh token is expired / revoked / invalid — force re-login. */
	get isRefreshDead() {
		return (
			this.code === 'refresh_expired' ||
			this.code === 'refresh_revoked' ||
			this.code === 'refresh_invalid'
		)
	}
}
