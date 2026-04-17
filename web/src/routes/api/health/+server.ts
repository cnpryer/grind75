import { json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { ApiClient } from '$lib/api/client'

const API_URL = env.API_URL || 'http://127.0.0.1:3001'

export const GET: RequestHandler = async () => {
	try {
		const api = new ApiClient(API_URL)
		const body = await api.health()
		return json(body)
	} catch {
		return json({ status: 'down' }, { status: 503 })
	}
}
