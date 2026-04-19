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

export type ProgressStatus = 'not_started' | 'attempted' | 'solved'

export interface ProgressRecord {
	slug: string
	status: ProgressStatus
	last_code: string | null
	notes: string | null
	attempt_count: number
	solved_at: string | null
	updated_at: string
}

export interface UpsertProgressRequest {
	status?: ProgressStatus
	last_code?: string
	notes?: string
}

export interface AttemptRecord {
	id: string
	slug: string
	code: string
	passed: boolean
	duration_ms: number
	pytest_summary: unknown
	created_at: string
}

export interface CreateAttemptRequest {
	slug: string
	code: string
	passed: boolean
	duration_ms: number
	pytest_summary: unknown
}

export interface ListAttemptsParams {
	slug?: string
	limit?: number
}

export interface HeatmapCell {
	/** ISO date (YYYY-MM-DD) in UTC. */
	date: string
	count: number
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

	// --- Progress ---
	listProgress() {
		return this.request<ProgressRecord[]>('GET', '/api/progress')
	}

	getProgress(slug: string) {
		return this.request<ProgressRecord>('GET', `/api/progress/${encodeURIComponent(slug)}`)
	}

	upsertProgress(slug: string, data: UpsertProgressRequest) {
		return this.request<ProgressRecord>('PUT', `/api/progress/${encodeURIComponent(slug)}`, data)
	}

	resetProgress() {
		return this.request<void>('DELETE', '/api/progress')
	}

	// --- Attempts ---
	listAttempts(params: ListAttemptsParams = {}) {
		const query = new URLSearchParams()
		if (params.slug) query.set('slug', params.slug)
		if (params.limit !== undefined) query.set('limit', String(params.limit))
		const suffix = query.size > 0 ? `?${query.toString()}` : ''
		return this.request<AttemptRecord[]>('GET', `/api/attempts${suffix}`)
	}

	createAttempt(data: CreateAttemptRequest) {
		return this.request<AttemptRecord>('POST', '/api/attempts', data)
	}

	getHeatmap(days?: number) {
		const query = new URLSearchParams()
		if (days !== undefined) query.set('days', String(days))
		const suffix = query.size > 0 ? `?${query.toString()}` : ''
		return this.request<HeatmapCell[]>('GET', `/api/attempts/heatmap${suffix}`)
	}
}
