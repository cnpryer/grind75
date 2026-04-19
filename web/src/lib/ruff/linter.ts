/**
 * Main-thread controller for the Ruff WASM worker.
 *
 * Lazy worker spawn, serialized per-kind queueing (latest-wins for `check`),
 * and a small typed API that the Monaco integration consumes. `check` is
 * debounced upstream by the Monaco wrapper; this class is fine to call
 * unconditionally on every keystroke but exposes `cancel()` so stale
 * diagnostics don't race a newer request.
 */

import type { RuffDiagnostic, WorkerRequest, WorkerResponse } from './protocol'

export type { RuffDiagnostic }

export type WorkerFactory = () => Worker

const defaultWorkerFactory: WorkerFactory = () =>
	new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

type Pending =
	| { kind: 'init'; resolve: (v: { version: string }) => void; reject: (e: Error) => void }
	| { kind: 'check'; resolve: (v: RuffDiagnostic[]) => void; reject: (e: Error) => void }
	| { kind: 'format'; resolve: (v: string) => void; reject: (e: Error) => void }

export class RuffLinter {
	private worker: Worker | null = null
	private pending = new Map<string, Pending>()
	private nextId = 0
	private readonly factory: WorkerFactory
	private version: string | null = null

	constructor(factory: WorkerFactory = defaultWorkerFactory) {
		this.factory = factory
	}

	/** `null` until the worker has reported ready at least once. */
	get ruffVersion(): string | null {
		return this.version
	}

	async init(): Promise<{ version: string }> {
		return new Promise((resolve, reject) => {
			const requestId = this.enqueue({ kind: 'init', resolve, reject })
			this.send({ type: 'init', requestId })
		})
	}

	async check(source: string): Promise<RuffDiagnostic[]> {
		return new Promise((resolve, reject) => {
			const requestId = this.enqueue({ kind: 'check', resolve, reject })
			this.send({ type: 'check', requestId, source })
		})
	}

	async format(source: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const requestId = this.enqueue({ kind: 'format', resolve, reject })
			this.send({ type: 'format', requestId, source })
		})
	}

	/**
	 * Reject every in-flight request with `AbortError`. Does not terminate the
	 * worker — Monaco integrations call this when the user navigates away
	 * mid-check and then re-use the same linter for the next problem.
	 */
	cancel(): void {
		const err = new Error('linter request cancelled')
		err.name = 'AbortError'
		for (const [, p] of this.pending) p.reject(err)
		this.pending.clear()
	}

	dispose(): void {
		this.cancel()
		this.worker?.terminate()
		this.worker = null
	}

	// ---- internals --------------------------------------------------------

	private enqueue(p: Pending): string {
		const requestId = `${p.kind}-${++this.nextId}`
		this.pending.set(requestId, p)
		return requestId
	}

	private send(msg: WorkerRequest): void {
		this.ensureWorker().postMessage(msg)
	}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker
		const w = this.factory()
		w.addEventListener('message', (e) => this.onMessage(e.data as WorkerResponse))
		w.addEventListener('error', (e) => {
			const err = new Error((e as ErrorEvent).message ?? 'ruff worker crashed')
			for (const [, p] of this.pending) p.reject(err)
			this.pending.clear()
			this.worker?.terminate()
			this.worker = null
		})
		this.worker = w
		return w
	}

	private onMessage(msg: WorkerResponse): void {
		const p = this.pending.get(msg.requestId)
		if (!p) return
		this.pending.delete(msg.requestId)

		if (msg.type === 'error') {
			const err = new Error(msg.message)
			if (msg.stack) err.stack = msg.stack
			p.reject(err)
			return
		}
		if (msg.type === 'init:ready' && p.kind === 'init') {
			this.version = msg.version
			p.resolve({ version: msg.version })
			return
		}
		if (msg.type === 'check:result' && p.kind === 'check') {
			p.resolve(msg.diagnostics)
			return
		}
		if (msg.type === 'format:result' && p.kind === 'format') {
			p.resolve(msg.source)
			return
		}
		// Kind / response mismatch — surface as an error so tests/callers notice.
		p.reject(new Error(`ruff worker returned ${msg.type} for ${p.kind} request`))
	}
}
