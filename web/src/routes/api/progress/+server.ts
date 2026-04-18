import { json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const GET: RequestHandler = async ({ locals }) => {
	const api = new ApiClient(API_URL, locals.accessToken)
	const body = await api.listProgress()
	return json(body)
}

export const DELETE: RequestHandler = async ({ locals }) => {
	const api = new ApiClient(API_URL, locals.accessToken)
	await api.resetProgress()
	return new Response(null, { status: 204 })
}
