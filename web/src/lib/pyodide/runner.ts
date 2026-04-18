/**
 * Main-thread controller for the Pyodide Web Worker.
 *
 * Responsibilities:
 *   - Lazy worker spawn (first Run click, not on page load — Pyodide is ~6MB).
 *   - Per-run timeout enforced by `worker.terminate()`; the next run respawns.
 *   - Serialize runs (one at a time) so the worker's virtual FS doesn't get
 *     trampled by concurrent writes.
 *
 * Consumers: `+page.svelte` for /problem/[slug] (M2+) and vitest tests.
 */

import type {
	InitPhase,
	PytestSummary,
	TestReport,
	WorkerRequest,
	WorkerResponse,
} from './protocol'
import { TimeoutError } from './protocol'

export type InitProgress = { phase: InitPhase; message: string }

export interface RunOptions {
	code: string
	tests: string
	entryFunction: string
	timeoutMs: number
}

export interface RunResult {
	summary: PytestSummary
	stdout: string
	stderr: string
	durationMs: number
}

/** Spawns the worker URL. Separated so tests can inject a stub. */
export type WorkerFactory = () => Worker

/** Default factory — bundled module worker, built by Vite. */
const defaultWorkerFactory: WorkerFactory = () =>
	new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

type Pending = {
	resolve: (result: RunResult) => void
	reject: (err: Error) => void
	timer: ReturnType<typeof setTimeout> | null
	kind: 'init' | 'run'
}

export class PyodideRunner {
	private worker: Worker | null = null
	private pending = new Map<string, Pending>()
	private nextId = 0
	private initialized = false
	private onInitProgress: ((p: InitProgress) => void) | null = null
	private readonly factory: WorkerFactory

	constructor(factory: WorkerFactory = defaultWorkerFactory) {
		this.factory = factory
	}

	/** True once the worker has completed one init cycle and is ready to run. */
	get isReady(): boolean {
		return this.initialized
	}

	/** Subscribe to init progress messages (loading pyodide, pytest, etc.). */
	setInitProgressHandler(handler: ((p: InitProgress) => void) | null): void {
		this.onInitProgress = handler
	}

	/** Eagerly bring the worker up. Idempotent. */
	async init(): Promise<void> {
		await this.ensureReady()
	}

	/** Run a single problem. Serializes if another run is in flight. */
	async run(opts: RunOptions): Promise<RunResult> {
		await this.ensureReady()
		return this.dispatch('run', opts.timeoutMs, (requestId) => ({
			type: 'run',
			requestId,
			code: opts.code,
			tests: opts.tests,
			entryFunction: opts.entryFunction,
		}))
	}

	/** Tear down the worker. Safe to call multiple times. */
	dispose(): void {
		this.reject(new Error('runner disposed'))
		this.worker?.terminate()
		this.worker = null
		this.initialized = false
	}

	// ---- internals --------------------------------------------------------

	private ensureWorker(): Worker {
		if (this.worker) return this.worker
		const w = this.factory()
		w.addEventListener('message', (e) => this.onMessage(e.data as WorkerResponse))
		w.addEventListener('error', (e) => {
			// Unhandled worker error — terminate and surface to all pending calls.
			const msg = (e as ErrorEvent).message ?? 'worker crashed'
			this.reject(new Error(msg))
			this.worker?.terminate()
			this.worker = null
			this.initialized = false
		})
		this.worker = w
		return w
	}

	private async ensureReady(): Promise<void> {
		if (this.initialized && this.worker) return
		await this.dispatch('init', INIT_TIMEOUT_MS, (requestId) => ({
			type: 'init',
			requestId,
		}))
		this.initialized = true
	}

	private dispatch(
		kind: 'init' | 'run',
		timeoutMs: number,
		build: (requestId: string) => WorkerRequest,
	): Promise<RunResult> {
		const worker = this.ensureWorker()
		const requestId = `${kind}-${++this.nextId}`

		return new Promise<RunResult>((resolve, reject) => {
			const timer =
				timeoutMs > 0
					? setTimeout(() => {
							this.onTimeout(requestId, timeoutMs)
						}, timeoutMs)
					: null
			this.pending.set(requestId, { resolve, reject, timer, kind })
			worker.postMessage(build(requestId))
		})
	}

	private onMessage(msg: WorkerResponse): void {
		if (msg.type === 'init:progress') {
			this.onInitProgress?.({ phase: msg.phase, message: msg.message })
			return
		}
		const p = this.pending.get(msg.requestId)
		if (!p) return

		if (msg.type === 'init:ready') {
			if (p.kind !== 'init') return
			this.clear(msg.requestId)
			// Init resolves with a dummy RunResult — callers of init() discard it.
			p.resolve(EMPTY_RUN_RESULT)
			return
		}

		if (msg.type === 'run:result') {
			this.clear(msg.requestId)
			p.resolve({
				summary: msg.summary,
				stdout: msg.stdout,
				stderr: msg.stderr,
				durationMs: msg.durationMs,
			})
			return
		}

		if (msg.type === 'error') {
			this.clear(msg.requestId)
			const err = new Error(msg.message)
			if (msg.stack) err.stack = msg.stack
			p.reject(err)
		}
	}

	private onTimeout(requestId: string, timeoutMs: number): void {
		const p = this.pending.get(requestId)
		if (!p) return
		this.clear(requestId)
		// Terminate so the wedged interpreter (e.g. `while True: pass`) dies.
		// Subsequent runs spin up a fresh worker.
		this.worker?.terminate()
		this.worker = null
		this.initialized = false
		// Siblings share the now-dead worker; fail them too.
		this.reject(new TimeoutError(timeoutMs))
		p.reject(new TimeoutError(timeoutMs))
	}

	private reject(err: Error): void {
		for (const [, p] of this.pending) {
			if (p.timer) clearTimeout(p.timer)
			p.reject(err)
		}
		this.pending.clear()
	}

	private clear(requestId: string): void {
		const p = this.pending.get(requestId)
		if (p?.timer) clearTimeout(p.timer)
		this.pending.delete(requestId)
	}
}

/**
 * Worker initialization (download Pyodide, load pytest) takes ~6s cold on a
 * fast connection. 60s is a generous ceiling that only fires on genuine
 * failure (e.g. missing static assets) rather than slow networks.
 */
const INIT_TIMEOUT_MS = 60_000

const EMPTY_RUN_RESULT: RunResult = {
	summary: { passed: 0, failed: 0, errored: 0, skipped: 0, total: 0, tests: [] },
	stdout: '',
	stderr: '',
	durationMs: 0,
}

export type { TestReport }
