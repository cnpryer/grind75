import { ApiError } from './errors'

/**
 * Interim hand-typed DTOs for M0. These are swapped out for the
 * `openapi-typescript`-generated types when the `api:types` pipeline lands
 * (see PLAN.md "Type synchronization via OpenAPI"). Keep the shapes in
 * lockstep with `api/src/dto/auth.rs` until then.
 */
export interface UserProfile {
	username: string
}

export interface AuthResponse {
	access_token: string
	refresh_token: string
	user: UserProfile
}

export interface LoginRequest {
	username: string
	password: string
}

export interface RefreshRequest {
	refresh_token: string
}

export interface LogoutRequest {
	refresh_token: string
}

/**
 * Minimal typed HTTP client for the Rust API. Constructed server-side only
 * (inside `+*.server.ts` / `+server.ts`) with the access token read from
 * `locals.accessToken` — the browser never instantiates this directly.
 */
export class ApiClient {
	private baseUrl: string
	private accessToken: string | null

	constructor(baseUrl: string, accessToken: string | null = null) {
		this.baseUrl = baseUrl
		this.accessToken = accessToken
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' }
		if (this.accessToken) {
			headers.Authorization = `Bearer ${this.accessToken}`
		}

		const res = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		})

		if (!res.ok) {
			const errorBody = await res.json().catch(() => ({}))
			throw new ApiError(res.status, errorBody)
		}

		if (res.status === 204) {
			return undefined as T
		}

		return res.json()
	}

	// --- Auth ---
	login(data: LoginRequest) {
		return this.request<AuthResponse>('POST', '/api/auth/login', data)
	}

	refresh(data: RefreshRequest) {
		return this.request<AuthResponse>('POST', '/api/auth/refresh', data)
	}

	/** Best-effort revoke. Access token required; refresh token in body. */
	logout(data: LogoutRequest) {
		return this.request<void>('POST', '/api/auth/logout', data)
	}

	me() {
		return this.request<UserProfile>('GET', '/api/auth/me')
	}

	health() {
		return this.request<{ status: string }>('GET', '/api/health')
	}
}
