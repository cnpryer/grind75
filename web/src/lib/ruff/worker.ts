/// <reference lib="webworker" />
/**
 * Ruff WASM worker: loads `@astral-sh/ruff-wasm-web` once, then services
 * `check` / `format` requests from the main thread.
 *
 * Mirrors the shape of the Pyodide worker — "one init, many runs". Init is
 * cheap compared to Pyodide (~3MB WASM, fully synchronous after fetch), but
 * we still defer the first init until a consumer asks for it so the dashboard
 * doesn't pay the download cost.
 */

import init, { PositionEncoding, Workspace } from '@astral-sh/ruff-wasm-web'
// `?url` pulls the WASM asset through Vite's pipeline so it's emitted as a
// hashed asset and reachable from the worker bundle. Without this the default
// `new URL('ruff_wasm_bg.wasm', import.meta.url)` in the generated loader
// points at a path Vite never served (observed as a 200 HTML shell, which
// `WebAssembly.compile` rejects as "HTTP status code is not ok").
import wasmUrl from '@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm?url'
import ruffConfig from './generated-config.json'
import type { RuffDiagnostic, WorkerRequest, WorkerResponse } from './protocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

let workspace: Workspace | null = null
let version = ''
let initPromise: Promise<void> | null = null

function post(msg: WorkerResponse): void {
	ctx.postMessage(msg)
}

async function ensureReady(): Promise<void> {
	if (workspace) return
	if (!initPromise) {
		initPromise = (async () => {
			await init(wasmUrl)
			workspace = new Workspace(ruffConfig, PositionEncoding.Utf16)
			version = Workspace.version()
		})()
		initPromise.finally(() => {
			// Keep the promise pinned on success (workspace !== null short-circuits),
			// clear on failure so a retry starts fresh.
			if (!workspace) initPromise = null
		})
	}
	await initPromise
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
	void handle(event.data)
})

async function handle(msg: WorkerRequest): Promise<void> {
	try {
		await ensureReady()
		const ws = workspace
		if (!ws) throw new Error('ruff workspace unavailable after init')

		if (msg.type === 'init') {
			post({ type: 'init:ready', requestId: msg.requestId, version })
			return
		}
		if (msg.type === 'check') {
			const diagnostics = ws.check(msg.source) as RuffDiagnostic[]
			post({ type: 'check:result', requestId: msg.requestId, diagnostics })
			return
		}
		if (msg.type === 'format') {
			const formatted = ws.format(msg.source)
			post({ type: 'format:result', requestId: msg.requestId, source: formatted })
			return
		}
	} catch (err) {
		const e = err as Error
		post({
			type: 'error',
			requestId: (msg as { requestId: string }).requestId,
			message: e.message ?? String(err),
			stack: e.stack,
		})
	}
}
