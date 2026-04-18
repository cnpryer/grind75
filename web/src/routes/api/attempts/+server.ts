import { json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'
import { ApiError } from '$lib/api/errors'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const GET: RequestHandler = async ({ locals, url }) => {
	const slug = url.searchParams.get('slug') ?? undefined
	const limit = url.searchParams.get('limit')
	const parsedLimit = limit ? Number(limit) : undefined

	try {
		const api = new ApiClient(API_URL, locals.accessToken)
		const body = await api.listAttempts({
			slug,
			limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
		})
		return json(body)
	} catch (error) {
		if (error instanceof ApiError) {
			return json({ error: error.code, message: error.message }, { status: error.status })
		}
		throw error
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const api = new ApiClient(API_URL, locals.accessToken)
		const payload = await request.json()
		const body = await api.createAttempt(payload)
		return json(body, { status: 201 })
	} catch (error) {
		if (error instanceof ApiError) {
			return json({ error: error.code, message: error.message }, { status: error.status })
		}
		throw error
	}
}
