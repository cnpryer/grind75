import { json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'
import { ApiError } from '$lib/api/errors'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!params.slug) {
		return json({ error: 'missing_slug' }, { status: 400 })
	}
	try {
		const api = new ApiClient(API_URL, locals.accessToken)
		const body = await api.getProgress(params.slug)
		return json(body)
	} catch (error) {
		if (error instanceof ApiError) {
			return json({ error: error.code, message: error.message }, { status: error.status })
		}
		throw error
	}
}

export const PUT: RequestHandler = async ({ request, locals, params }) => {
	if (!params.slug) {
		return json({ error: 'missing_slug' }, { status: 400 })
	}
	try {
		const api = new ApiClient(API_URL, locals.accessToken)
		const payload = await request.json()
		const body = await api.upsertProgress(params.slug, payload)
		return json(body)
	} catch (error) {
		if (error instanceof ApiError) {
			return json({ error: error.code, message: error.message }, { status: error.status })
		}
		throw error
	}
}
